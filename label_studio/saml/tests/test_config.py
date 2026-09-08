import pytest
from django.core.exceptions import ImproperlyConfigured
from django.test import RequestFactory
from saml import config
from saml2 import BINDING_HTTP_POST, BINDING_HTTP_REDIRECT

from .conftest import IDP_ENTITY_ID, IDP_SSO_URL, SP_ACS_URL, SP_ENTITY_ID


def test_idp_config_is_required(saml_settings):
    saml_settings.SAML_IDP_ENTITY_ID = None
    with pytest.raises(ImproperlyConfigured, match='no identity provider is configured'):
        config.get_idp_metadata_source()


def test_metadata_file_takes_precedence(saml_settings):
    saml_settings.SAML_IDP_METADATA_FILE = '/etc/label-studio/google-idp.xml'
    saml_settings.SAML_IDP_METADATA_URL = 'https://example.com/metadata.xml'
    assert config.get_idp_metadata_source() == {'local': ['/etc/label-studio/google-idp.xml']}


def test_metadata_url(saml_settings):
    saml_settings.SAML_IDP_METADATA_URL = 'https://example.com/metadata.xml'
    assert config.get_idp_metadata_source() == {'remote': [{'url': 'https://example.com/metadata.xml'}]}


def test_normalize_x509_cert_strips_pem_armour():
    pem = '-----BEGIN CERTIFICATE-----\nMIIB\n  Cd\n-----END CERTIFICATE-----\n'
    assert config.normalize_x509_cert(pem) == 'MIIBCd'


def test_idp_metadata_xml_escapes_attribute_values():
    xml = config.build_idp_metadata_xml('urn:idp', 'https://idp.example.com/sso?a=1&b="2"', 'ABC')
    assert 'Location="https://idp.example.com/sso?a=1&amp;b=&quot;2&quot;"' in xml
    assert '<ds:X509Certificate>ABC</ds:X509Certificate>' in xml


def test_sp_config_from_explicit_idp_values(saml_settings):
    conf = config.config_loader(None)

    assert conf.entityid == SP_ENTITY_ID
    assert conf.endpoint('assertion_consumer_service', BINDING_HTTP_POST, 'sp') == [SP_ACS_URL]
    assert conf.metadata.identity_providers() == [IDP_ENTITY_ID]
    sso = conf.metadata.single_sign_on_service(IDP_ENTITY_ID, BINDING_HTTP_REDIRECT)
    assert sso[0]['location'] == IDP_SSO_URL
    assert conf.getattr('allow_unsolicited', 'sp') is True
    assert conf.getattr('want_assertions_or_response_signed', 'sp') is True


def test_sp_entity_id_override(saml_settings):
    saml_settings.SAML_SP_ENTITY_ID = 'urn:label-studio:prod'
    assert config.config_loader(None).entityid == 'urn:label-studio:prod'


def test_base_url_falls_back_to_request_host(saml_settings):
    saml_settings.SAML_SP_BASE_URL = ''
    request = RequestFactory().get('/saml2/login/', HTTP_HOST='ls.example.com')
    assert config.get_sp_base_url(request) == 'http://ls.example.com'


def test_base_url_must_be_absolute(saml_settings):
    saml_settings.SAML_SP_BASE_URL = 'ls.example.com'
    with pytest.raises(ImproperlyConfigured, match='absolute public URL'):
        config.get_sp_base_url(None)


def test_missing_xmlsec_binary_is_reported(saml_settings, monkeypatch):
    saml_settings.SAML_XMLSEC_BINARY = None
    monkeypatch.setattr(config, 'get_xmlsec_binary', lambda paths: (_ for _ in ()).throw(RuntimeError('nope')))
    with pytest.raises(ImproperlyConfigured, match='xmlsec1'):
        config.get_xmlsec_binary_path()
