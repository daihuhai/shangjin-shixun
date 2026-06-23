import zipfile
from pathlib import Path

from docx import Document
from pypdf import PdfReader

from .config import ALLOWED_EXTENSIONS, UPLOAD_DIR
from .llm import analyze_image


def validate_extension(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError(f"不支持的文件类型: {suffix}")
    return suffix


def submission_dir(submission_id: str) -> Path:
    path = UPLOAD_DIR / submission_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def read_text_file(path: Path) -> str:
    for encoding in ("utf-8", "gbk", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="ignore")


def parse_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    chunks = []
    for page in reader.pages[:20]:
        chunks.append(page.extract_text() or "")
    return "\n".join(chunks)


def parse_docx(path: Path) -> str:
    doc = Document(str(path))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def parse_zip(path: Path) -> tuple[str, list[str]]:
    texts = []
    files = []
    with zipfile.ZipFile(path, "r") as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = info.filename
            files.append(name)
            suffix = Path(name).suffix.lower()
            if suffix in {".txt", ".md", ".java", ".py", ".js", ".sql", ".html", ".css", ".json"}:
                try:
                    content = archive.read(info).decode("utf-8", errors="ignore")
                    texts.append(f"===== {name} =====\n{content[:4000]}")
                except Exception:
                    continue
    return "\n\n".join(texts), files


def parse_submission_files(submission_id: str, files_meta: list[dict]) -> dict:
    pieces = []
    structure = {"files": [], "types": {}, "image_paths": []}

    for meta in files_meta:
        path = UPLOAD_DIR / meta["stored_name"]
        suffix = Path(meta["filename"]).suffix.lower()
        structure["files"].append(meta["filename"])
        structure["types"][meta["filename"]] = suffix

        try:
            if suffix in {".txt", ".md", ".java", ".py", ".js", ".sql", ".html", ".css"}:
                text = read_text_file(path)
                pieces.append(f"【{meta['filename']}】\n{text[:6000]}")
            elif suffix == ".pdf":
                text = parse_pdf(path)
                pieces.append(f"【{meta['filename']}】\n{text[:6000]}")
            elif suffix == ".docx":
                text = parse_docx(path)
                pieces.append(f"【{meta['filename']}】\n{text[:6000]}")
            elif suffix == ".zip":
                text, inner = parse_zip(path)
                structure["zipContents"] = {meta["filename"]: inner}
                pieces.append(f"【{meta['filename']}】\n{text[:8000]}")
            elif suffix in {".png", ".jpg", ".jpeg"}:
                # 图片文件标记为待视觉分析，由调用方异步处理
                structure["image_paths"].append({"path": str(path), "filename": meta["filename"]})
                pieces.append(f"【{meta['filename']}】[图片文件，等待视觉分析]")
            else:
                pieces.append(f"【{meta['filename']}】已接收，类型 {suffix}。")
        except Exception as exc:
            pieces.append(f"【{meta['filename']}】解析失败: {exc}")

    extracted = "\n\n".join(pieces).strip()
    summary = extracted[:800] + ("..." if len(extracted) > 800 else "")
    if not extracted:
        summary = "已上传文件，但未能提取可读文本，请结合文件名与类型进行核查。"

    return {
        "summary": summary,
        "extractedText": extracted[:50000],
        "structure": structure,
        "status": "success" if extracted else "partial"
    }
