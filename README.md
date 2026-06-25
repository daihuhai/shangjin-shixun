# 尚进实训平台

> 基于 AI 大模型的高校实训教学管理系统，覆盖任务发布、作业提交、AI 自动评分、风险检测、数据画像全流程。

[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.10+-yellow)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-orange)](./LICENSE)

---

## 功能概览

### 学生端
- 在线提交实训作业（支持 Word / PDF / 代码 / 压缩包等 15 种格式）
- 查看 AI 评分结果与维度分析
- 查看个人学习画像（能力雷达图、提交趋势、风险预警）
- 查看实训任务详情与截止时间

### 教师端
- 创建课程、管理班级、发布实训任务
- 批改学生作业，调整 AI 评分
- 查看班级整体成绩分布与提交统计
- 管理参考代码库，AI 辅助代码分析

### 管理员端
- 用户管理（教师 / 学生 / 管理员），支持学院-班级联动创建
- 组织架构管理（23 个二级学院、多个班级）
- 学院整体画像（KPI 概览、班级排行、教师贡献、风险预警）
- 教师画像 & 学生画像（多维度能力分析）
- 指标配置（评分维度、权重自定义）
- 报表中心（Excel / PDF 导出）
- 数据看板（全局统计、分数分布、提交趋势）

### AI 能力
- 基于大模型的作业自动评分（代码质量 / 文档规范性 / 功能实现度 / 过程表现）
- 作业风险检测（抄袭检测、格式合规、内容完整性）
- 参考代码智能分析
- 图片识别与内容提取
- AI 生成学院改进建议

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19 + Vite 7 + React Router 7 + ECharts 6 |
| **后端** | FastAPI 0.115 + Uvicorn + SQLite |
| **AI** | 豆包大模型（Doubao Seed 2.0 Pro） |
| **文档处理** | pypdf / python-docx / openpyxl / fpdf2 |
| **样式** | 纯 CSS（无 UI 框架） |

---

## 项目结构

```
shangjin-shixun/
├── backend/                  # 后端服务
│   ├── main.py               # FastAPI 入口（路由、认证、业务逻辑）
│   ├── app/
│   │   ├── config.py         # 配置（数据库路径、模型参数、上传限制）
│   │   ├── db.py             # 数据库初始化、迁移、工具函数
│   │   ├── seed.py           # 种子数据（用户、课程、班级、指标）
│   │   ├── evaluation.py     # AI 评分与风险检测核心逻辑
│   │   ├── llm.py            # 大模型调用封装
│   │   ├── parser.py         # 文件解析（PDF / Word / 代码）
│   │   ├── services.py       # 业务服务层（数据聚合、导出）
│   │   └── response.py       # 统一响应格式
│   ├── data/                 # 数据库 & 导出文件
│   ── uploads/              # 上传文件存储
├── frontend/                 # 前端应用
│   ├── src/
│   │   ├── views/
│   │   │   ├── auth/         # 登录 / 注册 / 找回密码
│   │   │   └── app/          # 业务页面（20+ 页面）
│   │   ├── services/         # API 请求封装
│   │   ├── state/            # 全局状态（AuthContext）
│   │   ├── api/              # HTTP 客户端
│   │   └── styles.css        # 全局样式
│   ├── vite.config.js        # Vite 配置（代理后端）
│   └── package.json
└── README.md
```

---

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+

### 1. 克隆仓库

```bash
git clone https://github.com/daihuhai/shangjin-shixun.git
cd shangjin-shixun
```

### 2. 启动后端

```bash
cd backend

# 创建虚拟环境（推荐）
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux

# 安装依赖
pip install -r requirements.txt

# 配置环境变量（可选，有默认值）
# 复制 .env.example 为 .env 并填写 ARK_API_KEY 等

# 启动服务
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

后端启动后访问 http://127.0.0.1:8000/docs 查看 API 文档。

### 3. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端启动后访问 http://127.0.0.1:5173/

### 4. 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | `admin` | `admin123` |
| 教师 | `teacher` | `teacher123` |
| 学生 | `student` | `student123` |

---

## 数据库说明

- 使用 **SQLite**，数据库文件位于 `backend/data/training_eval.db`
- 首次启动自动建表并写入种子数据
- 种子数据包含：23 个二级学院、多个班级、示例用户（教师 + 学生）、示例课程与任务

---

## API 接口概览

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 认证 | POST | `/api/auth/login` | 登录 |
| 认证 | POST | `/api/auth/register` | 注册 |
| 认证 | GET | `/api/auth/captcha` | 获取验证码 |
| 课程 | GET | `/api/courses` | 课程列表 |
| 课程 | POST | `/api/courses` | 创建课程 |
| 任务 | GET | `/api/tasks` | 任务列表 |
| 任务 | POST | `/api/tasks` | 发布任务 |
| 提交 | POST | `/api/submissions` | 提交作业 |
| 评分 | POST | `/api/submissions/{id}/evaluate` | AI 评分 |
| 用户 | GET | `/api/admin/users` | 用户列表 |
| 用户 | POST | `/api/admin/users` | 创建用户 |
| 画像 | GET | `/api/admin/users/{id}/profile` | 用户画像 |
| 学院 | GET | `/api/admin/colleges/{name}/profile` | 学院画像 |
| 班级 | GET | `/api/classes/colleges` | 学院列表 |
| 班级 | GET | `/api/classes/by-college` | 按学院查班级 |

完整 API 文档：http://127.0.0.1:8000/docs

---

## 核心特性

### 学院整体画像
管理员可查看任意学院的综合数据：
- KPI 卡片（学生数、班级数、任务数、提交率、平均分）
- 班级排行榜（Top / Bottom 5）
- 教师贡献榜
- 风险预警与 AI 改进建议

### 用户画像
- **学生画像**：能力雷达图、提交趋势、成绩分布、风险等级
- **教师画像**：带班数量、班级均分、任务发布数、批改及时率

### AI 自动评分
四大维度自动打分：
- 代码质量（25 分）
- 文档规范性（20 分）
- 功能实现度（35 分）
- 过程表现（20 分）

教师可在 AI 评分基础上手动调整。

### 风险检测
自动检测作业中的高风险项：
- 抄袭嫌疑
- 格式不合规
- 内容不完整
- 代码质量差

---

## 截图

| 登录页 | 教师工作台 | 学院画像 |
|--------|-----------|---------|
| 登录页 | 教师工作台 | 学院画像 |

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

## License

MIT License
