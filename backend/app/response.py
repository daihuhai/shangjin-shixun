import json
import re
from typing import Any

from fastapi import HTTPException


def ok(data: Any = None, message: str = "success"):
    return {"code": 0, "message": message, "data": data}


def fail(message: str, status_code: int = 400):
    raise HTTPException(status_code=status_code, detail={"code": status_code, "message": message, "data": None})


def extract_json(text: str) -> dict | list:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
        if match:
            return json.loads(match.group(1))
        raise ValueError("模型返回内容不是有效 JSON")
