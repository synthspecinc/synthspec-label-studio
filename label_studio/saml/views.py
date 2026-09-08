"""SAML views: thin wrappers over djangosaml2 that respect ``SAML_ENABLED`` and Label Studio sessions."""

import logging
from time import time

from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.http import Http404
from django.shortcuts import render
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from djangosaml2.views import AssertionConsumerServiceView, LoginView, MetadataView

logger = logging.getLogger(__name__)

GENERIC_FAILURE_MESSAGE = (
    "We couldn't sign you in with single sign-on. Try again, or ask your administrator to check the Label Studio logs."
)
DENIED_FAILURE_MESSAGE = 'This account is not allowed to sign in to Label Studio.'


class SamlEnabledMixin:
    """Hide the SAML endpoints entirely unless SAML is switched on."""

    def dispatch(self, request, *args, **kwargs):
        if not settings.SAML_ENABLED:
            raise Http404('SAML single sign-on is not enabled')
        return super().dispatch(request, *args, **kwargs)


class SamlLoginView(SamlEnabledMixin, LoginView):
    """Starts the SP-initiated flow: builds an AuthnRequest and redirects the browser to the IdP."""


class SamlMetadataView(SamlEnabledMixin, MetadataView):
    """Serves this instance's SP metadata (entity id, ACS URL) for registering it with the IdP."""


@method_decorator(csrf_exempt, name='dispatch')
class SamlAssertionConsumerServiceView(SamlEnabledMixin, AssertionConsumerServiceView):
    """Receives the signed SAML response from the IdP and logs the user in."""

    def post_login_hook(self, request, user, session_info):
        # Keep parity with users.functions.login(), which the inactivity-timeout middleware relies on.
        request.session['last_login'] = time()

    def handle_acs_failure(self, request, exception=None, status=403, **kwargs):
        logger.warning('SAML login failed: %s', exception, exc_info=exception)
        message = DENIED_FAILURE_MESSAGE if isinstance(exception, PermissionDenied) else GENERIC_FAILURE_MESSAGE
        return render(request, 'saml/login_error.html', {'message': message}, status=status)
