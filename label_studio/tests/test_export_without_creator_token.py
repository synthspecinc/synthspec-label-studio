"""Exports must not depend on the organization creator still holding a legacy API token (PROD-3042).

The Synthspec production copy has no legacy token for its organization creator, so every JSON export
failed with RelatedObjectDoesNotExist before this change.
"""

import json

import pytest
from data_export.functions import converter_access_token
from data_export.models import DataExport
from rest_framework.authtoken.models import Token
from tests.utils import make_project

IMAGE_CONFIG = (
    '<View><Image name="image" value="$image"/>'
    '<RectangleLabels name="label" toName="image"><Label value="cat"/></RectangleLabels></View>'
)

TASK = {
    'id': 1,
    'data': {'image': 'data:image/png;base64,iVBORw0KGgo='},
    'annotations': [
        {
            'id': 1,
            'result': [
                {
                    'id': 'r1',
                    'type': 'rectanglelabels',
                    'from_name': 'label',
                    'to_name': 'image',
                    'original_width': 100,
                    'original_height': 100,
                    'value': {'x': 1, 'y': 1, 'width': 5, 'height': 5, 'rotation': 0, 'rectanglelabels': ['cat']},
                }
            ],
        }
    ],
}


@pytest.mark.django_db
def test_json_export_works_when_the_organization_creator_has_no_legacy_token(business_client):
    project = make_project({'label_config': IMAGE_CONFIG}, business_client.user, use_ml_backend=False)
    Token.objects.filter(user=project.organization.created_by).delete()

    out, _, _ = DataExport.generate_export_file(project, [TASK], 'JSON', False, {}, hostname='https://ls.example.com')

    exported = json.loads(out.read())
    assert exported[0]['annotations'][0]['result'][0]['value']['rectanglelabels'] == ['cat']


@pytest.mark.django_db
def test_converter_access_token_is_the_creators_legacy_token_when_present(business_client):
    project = make_project({'label_config': IMAGE_CONFIG}, business_client.user, use_ml_backend=False)
    creator = project.organization.created_by
    expected = Token.objects.get(user=creator).key

    assert converter_access_token(project.organization) == expected

    Token.objects.filter(user=creator).delete()
    assert converter_access_token(project.organization) is None
