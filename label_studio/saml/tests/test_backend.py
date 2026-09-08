import pytest
from django.test import RequestFactory
from organizations.models import Organization, OrganizationMember
from saml.backends import LabelStudioSaml2Backend
from saml2.saml import NAMEID_FORMAT_EMAILADDRESS, NameID
from users.models import User

from .conftest import IDP_ENTITY_ID

ATTRIBUTE_MAPPING = {'first_name': ('first_name',), 'last_name': ('last_name',)}

pytestmark = pytest.mark.django_db


def session_info(email, first_name=None, last_name=None):
    ava = {}
    if first_name:
        ava['first_name'] = [first_name]
    if last_name:
        ava['last_name'] = [last_name]
    return {
        'issuer': IDP_ENTITY_ID,
        'name_id': NameID(format=NAMEID_FORMAT_EMAILADDRESS, text=email),
        'ava': ava,
    }


def authenticate(email, create_unknown_user=True, **names):
    request = RequestFactory().post('/saml2/acs/')
    return LabelStudioSaml2Backend().authenticate(
        request,
        session_info=session_info(email, **names),
        attribute_mapping=ATTRIBUTE_MAPPING,
        create_unknown_user=create_unknown_user,
        assertion_info={},
    )


def make_org(owner_email='owner@example.com'):
    owner = User.objects.create_user(owner_email, 'password123')
    return Organization.create_organization(created_by=owner, title='Existing org')


def test_creates_user_and_organization_on_first_login(saml_settings):
    user = authenticate('Ada@Example.com', first_name='Ada', last_name='Lovelace')

    assert user is not None
    assert user.email == 'ada@example.com'
    assert user.username == 'ada'
    assert user.first_name == 'Ada'
    assert user.last_name == 'Lovelace'
    assert not user.has_usable_password()

    org = Organization.objects.get()
    assert org.title == 'Label Studio'
    assert org.created_by == user
    assert user.active_organization == org
    assert org.has_permission(user)


def test_new_user_joins_existing_organization(saml_settings):
    org = make_org()

    user = authenticate('grace@example.com')

    assert Organization.objects.count() == 1
    assert user.active_organization == org
    assert org.has_permission(user)
    assert org.created_by != user


def test_existing_user_is_matched_case_insensitively_and_updated(saml_settings):
    org = make_org()
    existing = User.objects.create_user('grace@example.com', 'password123', first_name='G')
    org.add_user(existing)

    user = authenticate('GRACE@example.com', first_name='Grace', last_name='Hopper')

    assert user.pk == existing.pk
    assert User.objects.count() == 2
    user.refresh_from_db()
    assert user.first_name == 'Grace'
    assert user.last_name == 'Hopper'
    assert user.active_organization == org


def test_existing_user_without_membership_is_attached(saml_settings):
    org = make_org()
    existing = User.objects.create_user('grace@example.com', 'password123')

    user = authenticate('grace@example.com')

    assert user.pk == existing.pk
    assert org.has_permission(user)
    assert user.active_organization == org


def test_allowed_domains_are_enforced(saml_settings):
    saml_settings.SAML_ALLOWED_DOMAINS = ['example.com']

    assert authenticate('mallory@evil.example.net') is None
    assert not User.objects.filter(email='mallory@evil.example.net').exists()
    assert authenticate('alice@example.com') is not None


def test_unknown_users_are_refused_when_provisioning_is_off(saml_settings):
    assert authenticate('nobody@example.com', create_unknown_user=False) is None
    assert not User.objects.filter(email='nobody@example.com').exists()


def test_inactive_user_is_refused(saml_settings):
    org = make_org()
    user = User.objects.create_user('gone@example.com', 'password123', is_active=False)
    org.add_user(user)

    assert authenticate('gone@example.com') is None


def test_deactivated_member_is_refused(saml_settings):
    org = make_org()
    user = User.objects.create_user('former@example.com', 'password123')
    org.add_user(user)
    OrganizationMember.objects.get(user=user, organization=org).soft_delete()

    assert authenticate('former@example.com') is None


def test_password_authentication_is_ignored_by_saml_backend(saml_settings):
    User.objects.create_user('pw@example.com', 'password123')
    assert LabelStudioSaml2Backend().authenticate(None, email='pw@example.com', password='password123') is None
