"""Authentication backend that maps SAML assertions onto Label Studio users and organizations."""

import logging

from django.conf import settings
from djangosaml2.backends import Saml2Backend
from organizations.models import Organization

logger = logging.getLogger(__name__)

DEFAULT_ORGANIZATION_TITLE = 'Label Studio'


def normalize_email(value):
    return (value or '').strip().lower()


def email_domain_allowed(email):
    """True when ``SAML_ALLOWED_DOMAINS`` is empty or contains the email's domain."""
    allowed = settings.SAML_ALLOWED_DOMAINS
    if not allowed:
        return True
    domain = email.rsplit('@', 1)[-1] if '@' in email else ''
    return domain in allowed


def ensure_organization_membership(user):
    """Attach the user to the instance organization, mirroring the password signup flow.

    Returns the organization when the user holds an active membership, otherwise ``None``.
    """
    organization = Organization.objects.order_by('pk').first()
    if organization is None:
        organization = Organization.create_organization(created_by=user, title=DEFAULT_ORGANIZATION_TITLE)
    else:
        organization.add_user(user)

    if not organization.has_permission(user):
        # Membership was refused (closed account) or has been soft-deleted (deactivated user).
        return None

    if user.active_organization_id is None:
        user.active_organization = organization
        user.save(update_fields=['active_organization'])
    return organization


class LabelStudioSaml2Backend(Saml2Backend):
    """djangosaml2 backend with Label Studio provisioning rules.

    * Users are matched by e-mail (the SAML NameID), case-insensitively.
    * Optional allow-list of e-mail domains (``SAML_ALLOWED_DOMAINS``).
    * New users get a username derived from their e-mail and an unusable password.
    * Every SSO login guarantees an active organization membership; users without one are refused.
    """

    def clean_user_main_attribute(self, main_attribute):
        return normalize_email(main_attribute)

    def get_or_create_user(
        self,
        user_lookup_key,
        user_lookup_value,
        create_unknown_user,
        idp_entityid,
        attributes,
        attribute_mapping,
        request,
    ):
        if not email_domain_allowed(user_lookup_value):
            logger.warning(
                'SAML login refused for %s: e-mail domain is not in SAML_ALLOWED_DOMAINS', user_lookup_value
            )
            return None, False
        return super().get_or_create_user(
            user_lookup_key,
            user_lookup_value,
            create_unknown_user,
            idp_entityid,
            attributes,
            attribute_mapping,
            request,
        )

    def save_user(self, user, *args, **kwargs):
        if user.pk is None and not user.username:
            user.username = user.email.split('@')[0]
        return super().save_user(user, *args, **kwargs)

    def authenticate(self, request, **kwargs):
        user = super().authenticate(request, **kwargs)
        if user is None:
            return None
        if ensure_organization_membership(user) is None:
            logger.warning('SAML login refused for %s: no active organization membership', user.email)
            return None
        return user
