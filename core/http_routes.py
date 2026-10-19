"""Ordered method/path/handler table; transport guard runs before dispatch."""

from dataclasses import dataclass
import re
from core.errors import AppError


@dataclass(frozen=True)
class Route:
    method: str
    pattern: str
    handler: str


ROUTES = (
    Route("GET", "/api/health", "get_health"),
    Route("GET", "/api/auth/session", "get_session"),
    Route("GET", "/api/jobs", "get_jobs"),
    Route("GET", "/api/vpn", "get_vpn"),
    Route("GET", "(?:/api/jobs/).*", "get_job"),
    Route("GET", "(?:/api/map\\-preview|/api/map\\-tile)", "get_map"),
    Route("GET", "/api/media", "get_media"),
    Route("GET", "/api/providers", "get_providers"),
    Route("GET", "/api/plugins", "get_plugins"),
    Route("GET", "/api/plugin\\-library", "get_plugin_library"),
    Route("GET", "/api/settings", "get_settings"),
    Route("GET", "(?:/api/system\\-logs|/api/system\\-logs/export)", "get_system_logs"),
    Route("GET", "/api/databases", "get_databases"),
    Route("GET", "(?:/api/databases/).*", "get_database"),
    Route("GET", "/api/projects", "get_projects"),
    Route(
        "GET",
        "/api/projects/[^/]+/(?:logs|logs-export)",
        "get_project_logs",
    ),
    Route("GET", "(?:/api/projects/).*", "get_project"),
    Route("GET", "(?:/api/files/).*", "get_file"),
    Route("GET", "/.*", "get_static"),
    Route("POST", "/api/auth/login", "post_login"),
    Route("POST", "/api/files", "post_upload"),
    Route("POST", "/api/databases", "post_create_database"),
    Route("POST", "/api/databases/import/preview", "post_preview_import"),
    Route("POST", "/api/databases/import/commit", "post_commit_import"),
    Route("POST", "/api/databases/[^/]+", "post_update_database"),
    Route("POST", "/api/vpn", "post_save_vpn"),
    Route("POST", "/api/vpn/rotate", "post_rotate_vpn"),
    Route("POST", "/api/system\\-logs/clear", "post_clear_system_logs"),
    Route("POST", "/api/media/store", "post_store_media"),
    Route("POST", "/api/auth/logout", "post_logout"),
    Route("POST", "/api/jobs/[^/]+/cancel", "post_cancel_job"),
    Route("POST", "/api/settings", "post_save_settings"),
    Route("POST", "/api/plugin/install", "post_install_plugin"),
    Route("POST", "/api/plugin/remove", "post_remove_plugin"),
    Route("POST", "/api/plugin/connection", "post_connect_plugin"),
    Route("POST", "/api/plugin/settings", "post_configure_plugin"),
    Route("POST", "/api/repositories/add", "post_add_repository"),
    Route("POST", "/api/repositories/remove", "post_remove_repository"),
    Route("POST", "/api/repositories/refresh", "post_refresh_repository"),
    Route("POST", "/api/projects", "post_create_project"),
    Route("POST", "/api/projects/.*", "post_update_project"),
)
COMPILED = tuple((route, re.compile(route.pattern)) for route in ROUTES)


def dispatch(handler, method, path):
    for route, pattern in COMPILED:
        if route.method == method and pattern.fullmatch(path):
            return getattr(handler, route.handler)(path)
    raise AppError("not_found", 404)
