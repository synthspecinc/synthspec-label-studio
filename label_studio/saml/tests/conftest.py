import datetime
import shutil

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from saml.config import XMLSEC_SEARCH_PATHS

IDP_ENTITY_ID = 'https://accounts.google.com/o/saml2?idpid=C0test'
IDP_SSO_URL = 'https://accounts.google.com/o/saml2/idp?idpid=C0test'
SP_BASE_URL = 'http://testserver'
SP_ENTITY_ID = f'{SP_BASE_URL}/saml2/metadata/'
SP_ACS_URL = f'{SP_BASE_URL}/saml2/acs/'


def find_real_xmlsec1():
    found = shutil.which('xmlsec1')
    if found:
        return found
    for directory in XMLSEC_SEARCH_PATHS:
        candidate = f'{directory}/xmlsec1'
        if shutil.which(candidate):
            return candidate
    return None


requires_xmlsec1 = pytest.mark.skipif(find_real_xmlsec1() is None, reason='xmlsec1 binary not installed')


@pytest.fixture(scope='session')
def idp_keypair(tmp_path_factory):
    """Self-signed key/certificate the fake IdP signs assertions with."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'label-studio-test-idp')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    directory = tmp_path_factory.mktemp('saml-idp')
    key_path = directory / 'idp.key'
    cert_path = directory / 'idp.crt'
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
    cert_path.write_text(cert_pem)
    return {'key_path': str(key_path), 'cert_path': str(cert_path), 'cert_pem': cert_pem}


@pytest.fixture
def saml_settings(settings, tmp_path, idp_keypair):
    """Enable SAML against a fake Google-style IdP described with explicit values.

    The real ``xmlsec1`` binary is used when installed; otherwise a placeholder path keeps config
    loading working for tests that never touch signatures (those that do are marked
    ``requires_xmlsec1``).
    """
    xmlsec_binary = find_real_xmlsec1()
    if xmlsec_binary is None:
        placeholder = tmp_path / 'xmlsec1'
        placeholder.write_text('')
        xmlsec_binary = str(placeholder)

    settings.SAML_ENABLED = True
    settings.SAML_SP_BASE_URL = SP_BASE_URL
    settings.SAML_SP_ENTITY_ID = None
    settings.SAML_IDP_METADATA_FILE = None
    settings.SAML_IDP_METADATA_URL = None
    settings.SAML_IDP_METADATA_XML = None
    settings.SAML_IDP_ENTITY_ID = IDP_ENTITY_ID
    settings.SAML_IDP_SSO_URL = IDP_SSO_URL
    settings.SAML_IDP_X509_CERT = idp_keypair['cert_pem']
    settings.SAML_ALLOWED_DOMAINS = []
    settings.SAML_CREATE_UNKNOWN_USER = True
    settings.SAML_DISABLE_PASSWORD_LOGIN = False
    settings.SAML_LOGIN_AUTO_REDIRECT = False
    settings.SAML_XMLSEC_BINARY = xmlsec_binary
    return settings
