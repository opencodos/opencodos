def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data


def test_integrations_requires_auth(client):
    response = client.get("/api/integrations")
    assert response.status_code == 401


def test_integrations_with_valid_key(client, auth_headers):
    response = client.get("/api/integrations", headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_unauthenticated_mode(client, mock_settings, monkeypatch):
    monkeypatch.setattr(mock_settings, "atlas_allow_unauthenticated", True)
    response = client.get("/api/integrations")
    assert response.status_code == 200
