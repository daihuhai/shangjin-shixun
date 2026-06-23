import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
DB_PATH = DATA_DIR / "training_eval.db"
EXPORT_DIR = DATA_DIR / "exports"

ARK_API_KEY = os.getenv("ARK_API_KEY", "")
ARK_BASE_URL = os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
ARK_MODEL = os.getenv("ARK_MODEL", "doubao-seed-2-0-pro-260215")
MODEL_DISPLAY_NAME = os.getenv("MODEL_DISPLAY_NAME", "尚进大模型")
PLATFORM_NAME = os.getenv("PLATFORM_NAME", "尚进实训系统")
SECRET_KEY = os.getenv("SECRET_KEY", "training-eval-secret")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))

ALLOWED_EXTENSIONS = {
    ".txt", ".md", ".pdf", ".doc", ".docx",
    ".zip", ".java", ".py", ".js", ".sql", ".html", ".css",
    ".png", ".jpg", ".jpeg", ".ppt", ".pptx"
}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

for path in (DATA_DIR, UPLOAD_DIR, EXPORT_DIR):
    path.mkdir(parents=True, exist_ok=True)
