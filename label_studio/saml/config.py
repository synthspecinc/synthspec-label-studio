"""Build the pysaml2 service-provider (SP) configuration from Label Studio settings.

The configuration is assembled lazily, per request, through ``config_loader`` (wired via the
``SAML_CONFIG_LOADER`` setting). A missing or broken SAML setup therefore never breaks Django
startup: problems surface as ``ImproperlyConfigured`` on the SAML views only.
"""

import logging
import re
from xml.sax.saxutils import escape

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from saml2 import BINDING_HTTP_POST
from saml2.config import SPConfig
from saml2.saml import NAMEID_FORMAT_EMAILADDRESS
from saml2.sigver import get_xmlsec_binary

logger = logging.getLogger(__name__)

# Extra locations searched for the xmlsec1 binary besides $PATH (Homebrew on macOS, etc.)
XMLSEC_SEARCH_PATHS = ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']

ACS_PATH = '/saml2/acs/'
METADATA_PATH = '/saml2/metadata/'

# Minimal IdP metadata document, used when the IdP is described with SAML_IDP_ENTITY_ID /
# SAML_IDP_SSO_URL / SAML_IDP_X509_CERT instead of a metadata file. Google Workspace exposes both
# the HTTP-Redirect and HTTP-POST bindings on the same URL.
IDP_METADATA_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
                     entityID="{entity_id}">
  <md:IDPSSODescriptor WantAuthnRequestsSigned="false"
                       protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo>
        <ds:X509Data>
          <ds:X509Certificate>{cert}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="{sso_url}"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="{sso_url}"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>
"""


def _attr(value):
    """Escape a value for use inside a double-quoted XML attribute."""
    return escape(value, {'"': '&quot;'})


def normalize_x509_cert(cert):
    """Strip PEM armour and all whitespace so the certificate can be embedded in metadata."""
    body = re.sub(r'-----(BEGIN|END) CERTIFICATE-----', '', cert or '')
    return ''.join(body.split())


def build_idp_metadata_xml(entity_id, sso_url, x509_cert):
    """Render an IdP metadata document from the three values Google shows on the SAML app page."""
    return IDP_METADATA_TEMPLATE.format(
        entity_id=_attr(entity_id),
        sso_url=_attr(sso_url),
        cert=normalize_x509_cert(x509_cert),
    )


def get_idp_metadata_source():
    """Return the pysaml2 ``metadata`` mapping for the configured identity provider.

    Sources are tried in order: metadata file, metadata URL, inline metadata XML, and finally the
    explicit entity id / SSO URL / certificate triple.
    """
    if settings.SAML_IDP_METADATA_FILE:
        return {'local': [settings.SAML_IDP_METADATA_FILE]}
    if settings.SAML_IDP_METADATA_URL:
        return {'remote': [{'url': settings.SAML_IDP_METADATA_URL}]}
    if settings.SAML_IDP_METADATA_XML:
        return {'inline': [settings.SAML_IDP_METADATA_XML]}
    if settings.SAML_IDP_ENTITY_ID and settings.SAML_IDP_SSO_URL and settings.SAML_IDP_X509_CERT:
        return {
            'inline': [
                build_idp_metadata_xml(
                    settings.SAML_IDP_ENTITY_ID, settings.SAML_IDP_SSO_URL, settings.SAML_IDP_X509_CERT
                )
            ]
        }
    raise ImproperlyConfigured(
        'SAML is enabled but no identity provider is configured. Set SAML_IDP_METADATA_FILE '
        '(recommended for Google Workspace), SAML_IDP_METADATA_URL, SAML_IDP_METADATA_XML, '
        'or all three of SAML_IDP_ENTITY_ID, SAML_IDP_SSO_URL and SAML_IDP_X509_CERT.'
    )


def get_sp_base_url(request=None):
    """Absolute public URL of this Label Studio instance, without a trailing slash.

    ``SAML_SP_BASE_URL`` (falling back to ``HOST``) should be set explicitly in production so the SP
    entity id is stable. As a convenience for local development the request host is used otherwise.
    """
    base_url = (settings.SAML_SP_BASE_URL or '').strip().rstrip('/')
    if not base_url and request is not None:
        base_url = request.build_absolute_uri('/').rstrip('/')
    if not base_url.startswith(('http://', 'https://')):
        raise ImproperlyConfigured(
            'SAML_SP_BASE_URL (or HOST) must be the absolute public URL of this Label Studio instance, '
            'for example https://labelstudio.example.com'
        )
    return base_url


def get_sp_entity_id(base_url):
    return settings.SAML_SP_ENTITY_ID or f'{base_url}{METADATA_PATH}'


def get_acs_url(base_url):
    return f'{base_url}{ACS_PATH}'


def get_xmlsec_binary_path():
    if settings.SAML_XMLSEC_BINARY:
        return settings.SAML_XMLSEC_BINARY
    try:
        return get_xmlsec_binary(XMLSEC_SEARCH_PATHS)
    except Exception as exc:
        raise ImproperlyConfigured(
            'The xmlsec1 binary is required to verify SAML signatures but was not found. Install it '
            '(apk add xmlsec / apt-get install xmlsec1 / brew install libxmlsec1) or point '
            'SAML_XMLSEC_BINARY at it.'
        ) from exc


def build_sp_config(request=None):
    """Return the pysaml2 configuration dict for this instance as a service provider."""
    base_url = get_sp_base_url(request)
    return {
        'entityid': get_sp_entity_id(base_url),
        'xmlsec_binary': get_xmlsec_binary_path(),
        # Keep IdP attributes that are not in pysaml2's built-in attribute maps (e.g. the custom
        # attribute names configured on a Google Workspace SAML app).
        'allow_unknown_attributes': True,
        'metadata': get_idp_metadata_source(),
        'service': {
            'sp': {
                'name': 'Label Studio',
                'endpoints': {
                    'assertion_consumer_service': [(get_acs_url(base_url), BINDING_HTTP_POST)],
                },
                'name_id_format': [NAMEID_FORMAT_EMAILADDRESS],
                'name_id_policy_format': NAMEID_FORMAT_EMAILADDRESS,
                # The browser does not send our session cookies with the cross-site POST from the
                # IdP, so the AuthnRequest id cannot be matched. IdP-initiated logins (Google's app
                # launcher) also arrive unsolicited.
                'allow_unsolicited': True,
                'authn_requests_signed': False,
                'logout_requests_signed': False,
                # Accept a signature on either the response or the assertion (Google signs the
                # assertion by default and the response only when "Signed response" is enabled),
                # but never accept a completely unsigned response.
                'want_response_signed': False,
                'want_assertions_signed': False,
                'want_assertions_or_response_signed': True,
            }
        },
    }


def config_loader(request=None):
    """``SAML_CONFIG_LOADER`` entry point used by djangosaml2."""
    conf = SPConfig()
    conf.load(build_sp_config(request))
    return conf
