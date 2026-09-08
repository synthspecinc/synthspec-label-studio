# Vendored Python packages

Wheels here are referenced from `pyproject.toml` as Poetry path dependencies. Keep this directory
in the Docker build context (the Dockerfile copies it before `poetry install`).

## pysaml2-7.5.4+synthspec.1

Upstream [pysaml2 7.5.4](https://pypi.org/project/pysaml2/7.5.4/) with a single metadata change:
`Requires-Dist: pyopenssl (<24.3.0)` became `pyopenssl (>=25.0.0)`. No code was modified.

Why: pysaml2 (pulled in by djangosaml2 for SAML SSO) still caps pyOpenSSL at 24.2, and every
pyOpenSSL release that old fails to import against the cryptography 44+ this project ships.
Poetry has no dependency-override mechanism, so the relaxed pin lives in a vendored wheel.
pyOpenSSL 25/26 keep the `OpenSSL.crypto` APIs pysaml2 uses; the SAML test-suite
(`label_studio/saml/tests`) covers signature verification against them.

To rebuild: download the upstream wheel, `python -m wheel unpack` it, rename the dist-info
directory and `Version:` to `7.5.4+synthspec.1`, edit the `Requires-Dist` line, delete `RECORD`,
and `python -m wheel pack` the directory. Drop this wheel once upstream relaxes the pin.
