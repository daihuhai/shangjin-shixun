import { useEffect, useState } from "react";
import { useAuth } from "../../state/AuthContext";
import { useAsyncData } from "../../hooks/useAsyncData";
import { getMetrics, updateMetrics } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import { Panel } from "../../ui/PageBlocks";

export default function MetricsPage() {
  const { user } = useAuth();
  const { data, loading, error, reload: reloadMetrics } = useAsyncData(getMetrics, []);
  const [metrics, setMetrics] = useState([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setMetrics(data.map((item) => ({ ...item, weight: item.weight })));
    }
  }, [data]);

  function updateMetric(index, field, value) {
    setMetrics((current) => current.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await updateMetrics(metrics.map((item) => ({
        ...item,
        weight: Number(item.weight),
        maxScore: Number(item.maxScore)
      })));
      setMessage("指标配置已保存");
      reloadMetrics();
    } catch (err) {
      setMessage(err.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const readOnly = user.role === "student";

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <Panel title="评价指标配置" description="支持自定义指标名称、权重与满分，用于尚进大模型评分融合。">
          <form className="callout-stack" onSubmit={handleSave}>
            {metrics.map((metric, index) => (
              <div className="split-layout" key={metric.id || metric.name}>
                <label className="form-field"><span>指标名称</span><input disabled={readOnly} value={metric.name} onChange={(e) => updateMetric(index, "name", e.target.value)} /></label>
                <label className="form-field"><span>权重 (0-1)</span><input disabled={readOnly} type="number" step="0.05" min="0" max="1" value={metric.weight} onChange={(e) => updateMetric(index, "weight", e.target.value)} /></label>
                <label className="form-field"><span>满分</span><input disabled={readOnly} type="number" value={metric.maxScore} onChange={(e) => updateMetric(index, "maxScore", e.target.value)} /></label>
              </div>
            ))}
            {!readOnly ? (
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "保存中..." : "保存配置"}</button>
            ) : (
              <div className="input-like">学生仅可查看当前课程使用的指标权重。</div>
            )}
          </form>
        </Panel>

        {message ? <div className="success-text">{message}</div> : null}
      </div>
    </LoadState>
  );
}
