import base64
from urllib.parse import parse_qs, urlparse

import pytest
from organizations.models import Organization
from saml.config import config_loader
from saml2 import BINDING_HTTP_REDIRECT
from saml2.config import IdPConfig
from saml2.metadata import entity_descriptor
from saml2.saml import NAME_FORMAT_BASIC, NAMEID_FORMAT_EMAILADDRESS, NameID
from saml2.server import Server
from users.models import User

from .conftest import IDP_ENTITY_ID, IDP_SSO_URL, SP_ACS_URL, SP_ENTITY_ID, find_real_xmlsec1, requires_xmlsec1

pytestmark = pytest.mark.django_db

SSO_LINK = 'href="/saml2/login/?next='
PASSWORD_INPUT = 'name="password"'


@pytest.mark.parametrize('path', ['/saml2/login/', '/saml2/metadata/'])
def test_saml_endpoints_are_hidden_when_disabled(client, settings, path):
    settings.SAML_ENABLED = False
    assert client.get(path).status_code == 404


def test_acs_is_hidden_when_disabled(client, settings):
    settings.SAML_ENABLED = False
    assert client.post('/saml2/acs/', {'SAMLResponse': 'x'}).status_code == 404


@requires_xmlsec1
def test_metadata_describes_this_service_provider(client, saml_settings):
    response = client.get('/saml2/metadata/')

    assert response.status_code == 200
    assert response['Content-Type'].startswith('text/xml')
    body = response.content.decode()
    assert f'entityID="{SP_ENTITY_ID}"' in body
    assert f'Location="{SP_ACS_URL}"' in body
    assert NAMEID_FORMAT_EMAILADDRESS in body


def test_login_redirects_to_idp_with_relay_state(client, saml_settings):
    response = client.get('/saml2/login/?next=/projects/')

    assert response.status_code == 302
    location = urlparse(response['Location'])
    assert f'{location.scheme}://{location.netloc}{location.path}' == IDP_SSO_URL.split('?')[0]
    query = parse_qs(location.query)
    assert query['idpid'] == ['C0test']
    assert 'SAMLRequest' in query
    assert query['RelayState'] == ['/projects/']


def test_login_page_offers_sso_when_enabled(client, saml_settings):
    body = client.get('/user/login/').content.decode()
    assert SSO_LINK in body
    assert PASSWORD_INPUT in body


def test_login_page_has_no_sso_link_when_disabled(client, settings):
    settings.SAML_ENABLED = False
    body = client.get('/user/login/').content.decode()
    assert SSO_LINK not in body
    assert PASSWORD_INPUT in body


def test_login_page_hides_password_form_when_disabled(client, saml_settings):
    saml_settings.SAML_DISABLE_PASSWORD_LOGIN = True

    body = client.get('/user/login/').content.decode()
    assert SSO_LINK in body
    assert PASSWORD_INPUT not in body

    # Break-glass: the local form is still reachable explicitly (superusers only can use it).
    body = client.get('/user/login/?local=1').content.decode()
    assert PASSWORD_INPUT in body


def test_login_page_auto_redirects_to_idp(client, saml_settings):
    saml_settings.SAML_LOGIN_AUTO_REDIRECT = True

    response = client.get('/user/login/?next=/projects/')
    assert response.status_code == 302
    assert response['Location'] == '/saml2/login/?next=/projects/'

    assert client.get('/user/login/?local=1').status_code == 200


def test_password_login_rejected_for_regular_users_when_disabled(client, saml_settings):
    saml_settings.SAML_DISABLE_PASSWORD_LOGIN = True
    user = User.objects.create_user('user@example.com', 'password123')
    Organization.create_organization(created_by=user, title='Org')

    response = client.post('/user/login/', {'email': 'user@example.com', 'password': 'password123'})

    assert response.status_code == 200
    assert 'Password login is disabled' in response.content.decode()
    assert '_auth_user_id' not in client.session


def test_password_login_still_works_for_superusers_when_disabled(client, saml_settings):
    saml_settings.SAML_DISABLE_PASSWORD_LOGIN = True
    admin = User.objects.create_superuser('admin@example.com', 'password123')
    Organization.create_organization(created_by=admin, title='Org')

    response = client.post('/user/login/', {'email': 'admin@example.com', 'password': 'password123'})

    assert response.status_code == 302
    assert client.session['_auth_user_id'] == str(admin.pk)


def test_acs_requires_saml_response(client, saml_settings):
    assert client.post('/saml2/acs/', {}).status_code == 400


def test_acs_rejects_garbage_with_error_page(client, saml_settings):
    response = client.post('/saml2/acs/', {'SAMLResponse': base64.b64encode(b'<not-saml/>').decode()})

    assert response.status_code == 403
    assert 'Single sign-on failed' in response.content.decode()
    assert '_auth_user_id' not in client.session


def build_signed_response(idp_keypair, email, sign_assertion=True, sign_response=False, **identity):
    """Act as the IdP: produce a signed SAML response addressed to this SP."""
    xmlsec = find_real_xmlsec1()
    sp_metadata = str(entity_descriptor(config_loader(None)))
    idp_config = IdPConfig()
    idp_config.load(
        {
            'entityid': IDP_ENTITY_ID,
            'xmlsec_binary': xmlsec,
            'key_file': idp_keypair['key_path'],
            'cert_file': idp_keypair['cert_path'],
            'metadata': {'inline': [sp_metadata]},
            'service': {
                'idp': {
                    'endpoints': {'single_sign_on_service': [(IDP_SSO_URL, BINDING_HTTP_REDIRECT)]},
                    'policy': {
                        'default': {
                            'lifetime': {'minutes': 5},
                            'attribute_restrictions': None,
                            'name_form': NAME_FORMAT_BASIC,
                        }
                    },
                }
            },
        }
    )
    idp = Server(config=idp_config)
    response = idp.create_authn_response(
        identity={key: [value] for key, value in identity.items()},
        in_response_to=None,
        destination=SP_ACS_URL,
        sp_entity_id=SP_ENTITY_ID,
        name_id=NameID(format=NAMEID_FORMAT_EMAILADDRESS, text=email),
        authn={'class_ref': 'urn:oasis:names:tc:SAML:2.0:ac:classes:Password', 'authn_auth': IDP_ENTITY_ID},
        sign_assertion=sign_assertion,
        sign_response=sign_response,
    )
    return base64.b64encode(str(response).encode()).decode()


@requires_xmlsec1
def test_acs_logs_in_user_from_signed_assertion(client, saml_settings, idp_keypair):
    saml_response = build_signed_response(idp_keypair, 'ada@example.com', first_name='Ada', last_name='Lovelace')

    response = client.post('/saml2/acs/', {'SAMLResponse': saml_response, 'RelayState': '/projects/'})

    assert response.status_code == 302
    assert response['Location'] == '/projects/'
    user = User.objects.get(email='ada@example.com')
    assert user.first_name == 'Ada'
    assert user.last_name == 'Lovelace'
    assert user.active_organization is not None
    assert client.session['_auth_user_id'] == str(user.pk)
    assert 'last_login' in client.session


@requires_xmlsec1
def test_acs_accepts_signed_response_without_signed_assertion(client, saml_settings, idp_keypair):
    saml_response = build_signed_response(idp_keypair, 'ada@example.com', sign_assertion=False, sign_response=True)

    response = client.post('/saml2/acs/', {'SAMLResponse': saml_response})

    assert response.status_code == 302
    assert User.objects.filter(email='ada@example.com').exists()


@requires_xmlsec1
def test_acs_rejects_unsigned_response(client, saml_settings, idp_keypair):
    saml_response = build_signed_response(idp_keypair, 'ada@example.com', sign_assertion=False, sign_response=False)

    response = client.post('/saml2/acs/', {'SAMLResponse': saml_response})

    assert response.status_code == 403
    assert not User.objects.filter(email='ada@example.com').exists()


@requires_xmlsec1
def test_acs_rejects_disallowed_domain(client, saml_settings, idp_keypair):
    saml_settings.SAML_ALLOWED_DOMAINS = ['example.com']
    saml_response = build_signed_response(idp_keypair, 'mallory@evil.example.net')

    response = client.post('/saml2/acs/', {'SAMLResponse': saml_response})

    assert response.status_code == 403
    assert 'not allowed to sign in' in response.content.decode()
    assert not User.objects.filter(email='mallory@evil.example.net').exists()
