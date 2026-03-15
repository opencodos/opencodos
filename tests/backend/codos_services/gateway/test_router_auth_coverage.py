from backend.codos_services.gateway.auth import require_api_key
from backend.codos_services.gateway.routes.context import router as context_router
from backend.codos_services.gateway.routes.crm import router as crm_router
from backend.codos_services.gateway.routes.skills import router as skills_router


def _has_dependency(router, dependency) -> bool:
    return any(getattr(dep, "dependency", None) == dependency for dep in router.dependencies)


def test_crm_router_requires_api_key():
    assert _has_dependency(crm_router, require_api_key)


def test_context_router_requires_api_key():
    assert _has_dependency(context_router, require_api_key)


def test_skills_router_requires_api_key():
    assert _has_dependency(skills_router, require_api_key)
