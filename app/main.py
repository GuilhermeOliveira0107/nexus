from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.config import APP_NAME, BASE_DIR
from app.database import init_db
from app.routers import auth, servers, social, ws

init_db()

app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

app.include_router(auth.router)
app.include_router(servers.router)
app.include_router(social.router)
app.include_router(ws.router)


@app.get("/health")
def health():
    return JSONResponse({"ok": True, "app": APP_NAME})


@app.get("/")
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request, "app_name": APP_NAME})


@app.get("/favicon.svg")
def favicon():
    return FileResponse(BASE_DIR / "static" / "favicon.svg")
