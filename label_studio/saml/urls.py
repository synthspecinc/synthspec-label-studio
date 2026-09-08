from django.urls import path
from saml import views

# URL names match djangosaml2's own so templates and the library resolve them the same way.
urlpatterns = [
    path('saml2/login/', views.SamlLoginView.as_view(), name='saml2_login'),
    path('saml2/acs/', views.SamlAssertionConsumerServiceView.as_view(), name='saml2_acs'),
    path('saml2/metadata/', views.SamlMetadataView.as_view(), name='saml2_metadata'),
]
