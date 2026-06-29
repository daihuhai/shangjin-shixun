import { useState } from "react";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getModelConfig, getModelHealth, testModel } from "../../services/appService";
import { formatTime } from "../../api/client";
import { MODEL_NAME, PLATFORM_NAME } from "../../config/brand";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";
import { statusTone } from "./shared";

export default function ModelsPage() {
  const { data: config, loading, error, reload } = useAsyncData(getModelConfig, []);
  const { data: health } = useAsyncData(getModelHealth, []);
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    setMessage("");
    try {
      const result = await testModel();
      setMessage(result.healthy ? `${MODEL_NAME} 正常，延迟 ${result.latencyMs}ms` : `${MODEL_NAME} 异常：${result.message}`);
      reload();
    } catch (err) {
      setMessage(err.message || "测试失败");
    } finally {
      setTesting(false);
    }
  }

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <Panel
          title="尚进大模型管理"
          description={`${PLATFORM_NAME} 内置 ${MODEL_NAME}，用于实训成果核查与尚进大模型评分。`}
          actions={<button className="primary-button" type="button" disabled={testing} onClick={handleTest}>{testing ? "检测中..." : "健康检查"}</button>}
        >
          <div className="stats-grid">
            <div className="data-card"><span className="eyebrow">模型名称</span><strong>{config?.modelName || MODEL_NAME}</strong></div>
            <div className="data-card"><span className="eyebrow">类型</span><strong>{config?.type || "尚进云端大模型"}</strong></div>
            <div className="data-card"><span className="eyebrow">API 配置</span><strong>{config?.apiKeyConfigured ? "已配置" : "未配置"}</strong></div>
            <div className="data-card"><span className="eyebrow">健康状态</span><strong>{health?.healthy ? "正常" : "异常"}</strong></div>
          </div>
        </Panel>

        <Panel title="调用日志" description="记录核查、评分等场景的尚进大模型调用情况。">
          <Table
            columns={["场景", "模型", "耗时", "状态", "时间"]}
            rows={config?.logs || []}
            renderRow={(row) => (
              <tr key={`${row.created_at}-${row.scene}`}>
                <td>{row.scene}</td>
                <td>{MODEL_NAME}</td>
                <td>{row.latency_ms} ms</td>
                <td><span className={`status-chip status-${statusTone(row.success ? "成功" : "失败")}`}>{row.success ? "成功" : "失败"}</span></td>
                <td>{formatTime(row.created_at)}</td>
              </tr>
            )}
          />
        </Panel>

        {message ? <div className="success-text">{message}</div> : null}
      </div>
    </LoadState>
  );
}
