import base64
import secrets
import time
from pathlib import Path
from typing import Optional

import httpx

from .config import ARK_API_KEY, ARK_BASE_URL, ARK_MODEL, MODEL_DISPLAY_NAME
from .db import get_conn, new_id, utc_now
from .response import extract_json


async def chat_completion(messages: list[dict], scene: str = "general", temperature: float = 0.2) -> str:
    if not ARK_API_KEY:
        raise RuntimeError("未配置 ARK_API_KEY")

    started = time.perf_counter()
    url = f"{ARK_BASE_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": ARK_MODEL,
        "messages": messages,
        "temperature": temperature
    }
    headers = {
        "Authorization": f"Bearer {ARK_API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, json=payload, headers=headers)
            if response.status_code >= 400:
                detail = response.text[:300]
                raise RuntimeError(f"尚进大模型调用失败({response.status_code}): {detail}")
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            latency = int((time.perf_counter() - started) * 1000)
            # 视觉消息的 content 是列表，提取文本部分用于日志
            raw_content = messages[-1]["content"]
            log_input = ""
            if isinstance(raw_content, list):
                for part in raw_content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        log_input = part.get("text", "")[:500]
                        break
            else:
                log_input = str(raw_content)[:500]
            _log_call(scene, True, latency, log_input, content[:500])
            return content
    except Exception as exc:
        latency = int((time.perf_counter() - started) * 1000)
        raw_content = messages[-1]["content"]
        log_input = str(raw_content)[:500] if not isinstance(raw_content, list) else "[视觉多模态消息]"
        _log_call(scene, False, latency, log_input, "", str(exc))
        raise


async def analyze_image(image_path: Path) -> str:
    """使用LLM视觉能力分析图片，提取文字和内容描述"""
    image_data = image_path.read_bytes()
    base64_image = base64.b64encode(image_data).decode("utf-8")
    suffix = image_path.suffix.lower()
    mime_type = "image/png" if suffix == ".png" else "image/jpeg"

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}
                },
                {
                    "type": "text",
                    "text": (
                        "请仔细分析这张图片。"
                        "如果是代码截图，请完整提取所有可见的代码文字（保留缩进和格式）；"
                        "如果是运行结果/终端截图，请提取所有输出内容；"
                        "如果是界面截图，请描述界面中的所有文字、按钮、数据等信息；"
                        "如果是手写答案或笔记，请识别并转录所有文字内容。"
                        "用中文回答，尽量完整准确地还原图片中的一切信息。"
                    )
                }
            ]
        }
    ]
    return await chat_completion(messages, scene="vision_ocr", temperature=0.1)


async def health_check() -> dict:
    started = time.perf_counter()
    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是健康检查助手，只回复 OK。"},
                {"role": "user", "content": "ping"}
            ],
            scene="health"
        )
        latency = int((time.perf_counter() - started) * 1000)
        return {
            "healthy": True,
            "model": MODEL_DISPLAY_NAME,
            "engineModel": ARK_MODEL,
            "latencyMs": latency,
            "message": content.strip()[:80]
        }
    except Exception as exc:
        return {
            "healthy": False,
            "model": MODEL_DISPLAY_NAME,
            "engineModel": ARK_MODEL,
            "latencyMs": int((time.perf_counter() - started) * 1000),
            "message": str(exc)
        }


def fallback_check_analysis(task: dict, parse_summary: str) -> dict:
    checklist = [item.strip() for item in (task.get("checklist") or "").split("|") if item.strip()]
    if not checklist:
        checklist = ["成果完整性", "文档规范性", "功能实现度"]
    items = []
    for name in checklist[:6]:
        passed = len(parse_summary or "") > 80
        items.append({
            "name": name,
            "category": "完整性",
            "conclusion": "通过" if passed else "存疑",
            "riskLevel": "低" if passed else "中",
            "evidence": parse_summary[:200] if parse_summary else "未能提取足够文本，建议教师人工复核。",
            "suggestion": "补充说明或重新上传更完整的成果文件。",
            "needsReview": not passed
        })
    high_risk = sum(1 for item in items if item["riskLevel"] == "高")
    return {
        "overallConclusion": "存疑" if high_risk else "通过",
        "highRiskCount": high_risk,
        "items": items
    }


def fallback_auto_score_new(task: dict, extracted_text: str, reference_analysis: str = "") -> dict:
    """
    新版备用评分逻辑（当LLM不可用时使用）
    基于简单的文本相似度估算
    """
    # 简单的文本长度和关键词匹配作为备用方案
    ref_keywords = ["CREATE TABLE", "INSERT", "SELECT", "PRIMARY KEY", "NOT NULL", "varchar", "INT"]
    student_text = (extracted_text or "").upper()

    # 计算关键词匹配度
    matched = sum(1 for kw in ref_keywords if kw in student_text)
    similarity = min(50, int((matched / len(ref_keywords)) * 50)) if ref_keywords else 25

    # 基于文本长度判断完整性
    text_len = len(extracted_text or "")
    completeness = min(20, int((min(text_len, 1000) / 1000) * 20))

    # 正确性默认给中等分数（无法检测时）
    correctness = 20

    total = similarity + correctness + completeness

    return {
        "aiTotalScore": total,
        "similarityScore": similarity,
        "correctnessScore": correctness,
        "completenessScore": completeness,
        "dimensions": [
            {"name": "与参考文档相似度", "score": similarity, "total": 50, "evidence": "基于关键词匹配的备用评分"},
            {"name": "代码正确性", "score": correctness, "total": 30, "evidence": "尚进大模型暂不可用，默认给分"},
            {"name": "内容完整性", "score": completeness, "total": 20, "evidence": f"基于提交内容长度的评估（{text_len}字）"}
        ],
        "errors": [],
        "highlights": ["已提交作业"],
        "feedback": f"尚进大模型暂时不可用，系统已给出参考分 {total} 分。建议稍后重新提交以获取详细反馈。",
        "summary": f"备用评分：{total}分（建议重新触发完整评估）"
    }


async def run_check_analysis(task: dict, parse_summary: str, extracted_text: str) -> dict:
    prompt = f"""
你是软件实训教学核查助手。请根据任务要求与学生提交内容，输出 JSON：
{{
  "overallConclusion": "通过/存疑/不通过",
  "highRiskCount": 0,
  "items": [
    {{
      "name": "核查项名称",
      "category": "完整性|规范性|漏洞|步骤",
      "conclusion": "通过|不通过|存疑",
      "riskLevel": "低|中|高",
      "evidence": "证据片段",
      "suggestion": "修复建议",
      "needsReview": false
    }}
  ]
}}

任务标题：{task['title']}
任务说明：{task.get('description') or ''}
任务要求：{task.get('requirements') or ''}
核查清单：{task.get('checklist') or ''}
评分标准：{task.get('scoring_criteria') or ''}
解析摘要：{parse_summary}
提交内容摘录：
{extracted_text[:12000]}
"""
    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是严谨的实训核查专家，只返回 JSON。"},
                {"role": "user", "content": prompt}
            ],
            scene="check"
        )
        return extract_json(content)
    except Exception:
        return fallback_check_analysis(task, parse_summary)


def fallback_check_analysis(task: dict, parse_summary: str) -> dict:
    checklist = [item.strip() for item in (task.get("checklist") or "").split("|") if item.strip()]
    if not checklist:
        checklist = ["成果完整性", "文档规范性", "功能实现度"]
    items = []
    for name in checklist[:6]:
        passed = len(parse_summary or "") > 80
        items.append({
            "name": name,
            "category": "完整性",
            "conclusion": "通过" if passed else "存疑",
            "riskLevel": "低" if passed else "中",
            "evidence": parse_summary[:200] if parse_summary else "未能提取足够文本，建议教师人工复核。",
            "suggestion": "补充说明或重新上传更完整的成果文件。",
            "needsReview": not passed
        })
    high_risk = sum(1 for item in items if item["riskLevel"] == "高")
    return {
        "overallConclusion": "存疑" if high_risk else "通过",
        "highRiskCount": high_risk,
        "items": items
    }


async def run_auto_score(task: dict, check_items: list[dict], extracted_text: str, reference_analysis: str = "") -> dict:
    """
    新版评分逻辑：以参考文档为核心，基于相似度+正确性评分
    - 主要标准：与教师参考文档的匹配程度
    - 辅助检测：代码错误识别
    - 反馈机制：高分鼓励 + 错误定位
    """
    ref_context = f"\n\n【教师参考文档（100分标准）】\n{reference_analysis}" if reference_analysis else ""

    prompt = f"""
你是一位**温和且专业**的软件实训评分专家。请按照以下新规则进行评分：

## 评分理念
- 教师上传的参考文档是**100分标准**（已通过尚进大模型预检确认无误）
- 学生作业的首要评分依据：**与参考文档的接近程度**
- 不苛求完整的实训报告、测试步骤等材料，重点看核心内容是否正确

## 评分维度（总分100分）
1. **与参考文档相似度 (50分)**：
   - 45-50分：与参考文档高度一致或完全相同 ✨
   - 35-44分：主要部分一致，有少量差异
   - 20-34分：有相似之处但差异明显
   - 0-19分：与参考文档差异很大

2. **代码正确性 (30分)**：
   - 27-30分：无语法/逻辑错误，可直接运行
   - 20-26分：有小瑕疵但不影响功能
   - 10-19分：有明显错误需要修改
   - 0-9分：存在严重错误

3. **内容完整性 (20分)**：
   - 18-20分：覆盖了参考文档的主要内容
   - 12-17分：包含大部分关键内容
   - 6-11分：只有部分内容
   - 0-5分：内容严重缺失

## 评语要求（重要！）
根据分数给予不同风格的反馈：

**90分以上（优秀）**：
- 使用热情、肯定的语气
- 具体表扬做得好的地方（如"字段命名规范"、"约束配置合理"等）
- 给予鼓励："继续保持！"、"很棒的学习态度！"

**70-89分（良好）**：
- 先肯定再提出建议
- 指出具体可以改进的地方
- 鼓励性结尾："离满分很近了，加油！"

**60-69分（及格）**：
- 温和地指出问题所在
- 明确说明哪里与参考文档不一致
- 给出具体的修改方向

**60分以下（需改进）**：
- 清晰列出所有发现的错误（带行号或位置）
- 解释为什么这样写不对
- 提供正确的示例供学生参考

## 输出格式
请严格输出 JSON：
{{
  "aiTotalScore": 95,
  "similarityScore": 48,       // 相似度得分（0-50）
  "correctnessScore": 28,      // 正确性得分（0-30）
  "completenessScore": 19,     // 完整性得分（0-20）
  "dimensions": [
    {{
      "name": "与参考文档相似度",
      "score": 48,
      "total": 50,
      "evidence": "详细说明与参考文档的对比结果"
    }},
    {{
      "name": "代码正确性",
      "score": 28,
      "total": 30,
      "evidence": "说明是否有语法/逻辑错误"
    }},
    {{
      "name": "内容完整性",
      "score": 19,
      "total": 20,
      "evidence": "是否覆盖了主要内容"
    }}
  ],
  "errors": [                  // 发现的错误列表（如果有）
    {{
      "type": "语法错误|逻辑错误|缺失",
      "location": "具体位置描述",
      "description": "问题描述",
      "suggestion": "修改建议",
      "severity": "高|中|低"
    }}
  ],
  "highlights": [              // 做得好的地方（用于鼓励）
    "具体优点1",
    "具体优点2"
  ],
  "feedback": "详细的反馈评语（包含鼓励、问题定位、改进建议）",
  "summary": "一句话总结"
}}

## 参考信息
任务名称：{task['title']}
原评分标准（仅供参考）：{task.get('scoring_criteria') or '无'}
核查结果摘要（已排除教师标记「误判」的项）：{check_items[:3] if check_items else '无（所有核查项已被教师排除或无核查项）'}{ref_context}
**注意：以下核查结果已排除教师标记为「误判」的项，评分时请忽略这些被排除的问题。**

## 学生提交的内容（请仔细分析）：
{extracted_text[:10000]}
"""
    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是温和专业的实训评分专家，以参考文档为标杆进行评分。你善于发现学生的闪光点并给予鼓励，同时能清晰指出问题所在。只返回 JSON。"},
                {"role": "user", "content": prompt}
            ],
            scene="score",
            temperature=0.2  # 稍微提高一点随机性，让评语更自然
        )
        result = extract_json(content)

        # 确保返回格式完整
        return {
            "aiTotalScore": result.get("aiTotalScore", 75),
            "similarityScore": result.get("similarityScore", 38),
            "correctnessScore": result.get("correctnessScore", 23),
            "completenessScore": result.get("completenessScore", 15),
            "dimensions": result.get("dimensions", []),
            "errors": result.get("errors", []),
            "highlights": result.get("highlights", []),
            "feedback": result.get("feedback", ""),
            "summary": result.get("summary", "")
        }
    except Exception:
        return fallback_auto_score_new(task, extracted_text, reference_analysis)


async def analyze_reference_code(extracted_text: str, filename: str = "") -> dict:
    """分析教师参考文档，同时进行错误预检"""
    # 第一步：检查参考文档是否有语法/逻辑错误
    validation_result = await validate_reference_code(extracted_text, filename)

    # 第二步：深度分析教学意图
    prompt = f"""
你是一位资深软件实训教学专家。请深入分析教师上传的参考文档，理解其完整实现和教学意图，输出 JSON：

{{
  "codeSummary": "参考文档整体功能概述（100字以内）",
  "keyTechniques": ["使用的关键技术/框架1", "关键技术2"],
  "coreLogic": "核心业务逻辑与算法思路（200字以内）",
  "trainingIntent": "本实训希望学生掌握的核心能力点",
  "evaluationFocus": ["评分时应重点考察的维度1", "维度2", "维度3"],
  "commonPitfalls": ["学生容易犯的错误1", "错误2"],
  "idealStructure": "理想代码应具备的结构特征"
}}

文件名：{filename}
参考文档内容：
{extracted_text[:15000]}
"""
    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是软件实训教学分析专家，深入理解参考文档的教学意图，只返回 JSON。"},
                {"role": "user", "content": prompt}
            ],
            scene="reference_analysis"
        )
        analysis = extract_json(content)
        # 合并预检结果到分析结果中
        analysis["validation"] = validation_result
        return analysis
    except Exception as exc:
        return {
            "codeSummary": f"分析失败: {str(exc)[:100]}",
            "keyTechniques": [],
            "coreLogic": "",
            "trainingIntent": "",
            "evaluationFocus": [],
            "commonPitfalls": [],
            "idealStructure": "",
            "validation": validation_result
        }


async def validate_reference_code(extracted_text: str, filename: str = "") -> dict:
    """
    预检教师上传的参考文档是否有错误（语法、逻辑等）
    返回验证结果，决定是否将此文档作为100分标准
    """
    prompt = f"""
你是一个严格的代码审查专家。请仔细检查以下教师参考文档，找出所有可能的错误和问题。

输出 JSON 格式：
{{
  "isValid": true,
  "errorCount": 0,
  "errors": [],
  "warnings": [],
  "summary": "文档质量总结"
}}

检查维度：
1. **语法错误**：关键字拼写、符号缺失、格式错误等（这些会导致代码无法运行）
2. **逻辑错误**：缺少必要字段、约束配置不合理、业务逻辑矛盾等
3. **规范性问题**：命名不规范、缺少注释、结构混乱等（作为警告）

注意：
- 只有严重的语法错误和逻辑错误才计入 errorCount
- 规范性问题只记录在 warnings 中，不影响 isValid 判断
- 如果 isValid 为 false，说明这个参考文档本身有问题，不建议作为评分标准

文件名：{filename}
待检查内容：
{extracted_text[:12000]}
"""
    try:
        content = await chat_completion(
            [
                {"role": "system", "content": "你是严格的代码审查专家，专注于发现错误和问题。只返回 JSON。"},
                {"role": "user", "content": prompt}
            ],
            scene="reference_validation",
            temperature=0.1  # 降低随机性，确保审查一致性
        )
        result = extract_json(content)
        return {
            "isValid": result.get("isValid", True),
            "errorCount": result.get("errorCount", 0),
            "errors": result.get("errors", []),
            "warnings": result.get("warnings", []),
            "summary": result.get("summary", ""),
            "validatedAt": __import__("datetime").datetime.now().isoformat()
        }
    except Exception as exc:
        # 预检失败时默认认为有效，避免阻塞流程
        return {
            "isValid": True,
            "errorCount": 0,
            "errors": [f"预检过程异常: {str(exc)[:100]}"],
            "warnings": [],
            "summary": "预检异常，默认通过",
            "validatedAt": __import__("datetime").datetime.now().isoformat()
        }


def get_reference_analysis(task_id: str = "") -> str:
    with get_conn() as conn:
        if task_id:
            rows = conn.execute(
                "SELECT analysis_result FROM reference_codes WHERE task_id = ? AND analysis_status = 'done' AND analysis_result IS NOT NULL",
                (task_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT analysis_result FROM reference_codes WHERE analysis_status = 'done' AND analysis_result IS NOT NULL"
            ).fetchall()
    if not rows:
        return ""
    analyses = []
    for row in rows:
        try:
            import json
            data = json.loads(row["analysis_result"])
            parts = []
            if data.get("codeSummary"):
                parts.append(f"参考文档概述：{data['codeSummary']}")
            if data.get("keyTechniques"):
                parts.append(f"关键技术：{', '.join(data['keyTechniques'])}")
            if data.get("coreLogic"):
                parts.append(f"核心逻辑：{data['coreLogic']}")
            if data.get("trainingIntent"):
                parts.append(f"教学意图：{data['trainingIntent']}")
            if data.get("evaluationFocus"):
                parts.append(f"评分重点：{', '.join(data['evaluationFocus'])}")
            if data.get("commonPitfalls"):
                parts.append(f"常见问题：{', '.join(data['commonPitfalls'])}")
            if data.get("idealStructure"):
                parts.append(f"理想结构：{data['idealStructure']}")
            analyses.append("\n".join(parts))
        except Exception:
            continue
    return "\n\n---\n\n".join(analyses)


def _log_call(scene: str, success: bool, latency_ms: int, input_summary: str, output_summary: str, error_message: str = ""):
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO model_call_logs (id, scene, model_name, latency_ms, success, error_message, input_summary, output_summary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id(),
                str(scene),
                str(MODEL_DISPLAY_NAME),
                int(latency_ms),
                1 if success else 0,
                str(error_message),
                str(input_summary)[:500] if input_summary else "",
                str(output_summary)[:500] if output_summary else "",
                utc_now()
            )
        )


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, utc_now())
        )
    return token


def delete_session(token: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


def get_user_by_token(token: Optional[str]):
    if not token:
        return None
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT u.* FROM users u
            JOIN sessions s ON s.user_id = u.id
            WHERE s.token = ?
            """,
            (token,)
        ).fetchone()
        return dict(row) if row else None
