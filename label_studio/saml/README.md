# SAML single sign-on

This fork adds SAML 2.0 login to the open-source edition of Label Studio, using
[djangosaml2](https://github.com/IdentityPython/djangosaml2) / pysaml2. It is designed around
Google Workspace but works with any SAML identity provider (IdP).

What you get:

- A **Log in with SSO** button on the login page (`/saml2/login/` starts the flow).
- Just-in-time provisioning: the first SSO login creates the Label Studio user and adds them to the
  instance organization, exactly like password signup does. Existing users are matched by e-mail.
- Optional e-mail domain allow-list, optional lock-out of password login, optional automatic
  redirect to the IdP.
- SP metadata at `/saml2/metadata/` for registering the instance with the IdP.

What you do not get (Enterprise-only features): SCIM, IdP group to role mapping, per-organization
IdP settings, an admin UI for uploading metadata, and Single Logout. Logging out of Label Studio ends
the Label Studio session only; Google Workspace does not support SAML Single Logout anyway.

## Requirements

- The `xmlsec1` binary must be on the server. The Docker image installs it (`apk add xmlsec`). For
  other installs: `apt-get install xmlsec1`, `brew install libxmlsec1`, or set `SAML_XMLSEC_BINARY`.
- The instance must be reachable over HTTPS at a stable public URL. Set `HOST` (or
  `SAML_SP_BASE_URL`) to that URL, and if you run behind a reverse proxy configure
  `SECURE_PROXY_SSL_HEADER` / `USE_X_FORWARDED_HOST` as usual.

## Google Workspace setup

1. In the Google Admin console go to **Apps > Web and mobile apps > Add app > Add custom SAML app**.
2. Give it a name (for example "Label Studio") and continue.
3. On the **Google Identity Provider details** page click **Download metadata** and keep the XML
   file. (Alternatively copy the SSO URL, Entity ID and certificate for the explicit variables below.)
4. On **Service provider details** enter, replacing the host with yours:
   - **ACS URL**: `https://labelstudio.example.com/saml2/acs/`
   - **Entity ID**: `https://labelstudio.example.com/saml2/metadata/`
   - **Start URL** (optional): `https://labelstudio.example.com/saml2/login/`
   - **Signed response**: leave unchecked (checked also works).
   - **Name ID format**: `EMAIL`
   - **Name ID**: `Basic Information > Primary email`
5. On **Attribute mapping** add:
   - `Basic Information > First name` -> `first_name`
   - `Basic Information > Last name` -> `last_name`
6. Finish, then open the app and under **User access** turn it **ON** for the organizational units
   or groups that should be able to log in.
7. Copy the downloaded metadata file to the Label Studio server and configure the environment
   (see below). Restart Label Studio.
8. Visit `https://labelstudio.example.com/user/login/` and click **Log in with SSO**. Google can take
   a few minutes to activate a new SAML app.

## Configuration

All variables also accept the `LABEL_STUDIO_` prefix.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SAML_ENABLED` | `false` | Turn SAML on. Everything below is ignored when off. |
| `SAML_SP_BASE_URL` | value of `HOST` | Absolute public URL of this instance, no trailing slash. |
| `SAML_SP_ENTITY_ID` | `<base url>/saml2/metadata/` | Entity ID registered with the IdP. |
| `SAML_IDP_METADATA_FILE` | | Path to the IdP metadata XML (recommended). |
| `SAML_IDP_METADATA_URL` | | URL of the IdP metadata; fetched on every SAML request. |
| `SAML_IDP_METADATA_XML` | | Inline IdP metadata XML. |
| `SAML_IDP_ENTITY_ID`, `SAML_IDP_SSO_URL`, `SAML_IDP_X509_CERT` | | Describe the IdP without a metadata document. All three are required together. The certificate may be PEM or bare base64. |
| `SAML_ALLOWED_DOMAINS` | | Comma-separated e-mail domains allowed to log in, e.g. `example.com`. Empty allows any e-mail the IdP asserts. |
| `SAML_CREATE_UNKNOWN_USER` | `true` | Create Label Studio users on first login. Set to `false` to only allow pre-existing accounts. |
| `SAML_ATTR_FIRST_NAME`, `SAML_ATTR_LAST_NAME` | `first_name`, `last_name` | Names of the IdP attributes carrying the user's names. |
| `SAML_DISABLE_PASSWORD_LOGIN` | `false` | Hide the password form and reject password login for everyone except superusers. |
| `SAML_LOGIN_AUTO_REDIRECT` | `false` | Send visitors of `/user/login/` straight to the IdP. |
| `SAML_LOGIN_BUTTON_LABEL` | `Log in with SSO` | Text of the SSO button. |
| `SAML_XMLSEC_BINARY` | auto-detected | Path to `xmlsec1`. |

The first table row set is enough for Google Workspace:

```sh
HOST=https://labelstudio.example.com
SAML_ENABLED=true
SAML_IDP_METADATA_FILE=/label-studio/data/google-idp-metadata.xml
SAML_ALLOWED_DOMAINS=example.com
# Optional hardening once SSO is verified:
SAML_DISABLE_PASSWORD_LOGIN=true
DISABLE_SIGNUP_WITHOUT_LINK=true
```

## Break-glass access

With `SAML_DISABLE_PASSWORD_LOGIN=true` the password form is hidden, but superusers can still use
it at `/user/login/?local=1`. The same query parameter bypasses `SAML_LOGIN_AUTO_REDIRECT`. Create a
superuser with `python label_studio/manage.py createsuperuser` before locking password login.

## How users and organizations are handled

- Users are looked up by e-mail, case-insensitively, using the SAML NameID.
- New users get an unusable password and a username derived from the local part of the e-mail.
- Every SSO login checks that the user is an active member of the instance organization (the first
  organization in the database, created on the first login if none exists). Deactivated members and
  inactive users are refused.
- Superuser and staff flags are never changed by SAML.

## Security notes

- Responses must carry a signature on the response or on the assertion; unsigned responses are
  rejected. Google signs the assertion by default.
- AuthnRequests are not signed and assertions are not encrypted; Google supports neither.
- Unsolicited (IdP-initiated) responses are accepted so the Google app launcher works and so login
  survives the browser withholding cookies on the cross-site POST from the IdP.
- The SAML endpoints return 404 while `SAML_ENABLED` is off.
