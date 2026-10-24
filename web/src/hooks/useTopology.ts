import { useCallback, useEffect, useState } from "react";
import { fetchTopology, type ConnStatus, type Topology } from "@/lib/api";

/**
 * 拓扑在运行期可能变化（配置页保存后），所以不能只取一次：
 * - WebSocket 连上时拉取一次，覆盖“先开页面、后启动模拟器”的情况；
 * - 配置保存后调用 reload() 重新拉取。
 * undefined = 还没成功加载过，null = 点表确实没配 topology。
 */
export function useTopology(status: ConnStatus) {
  const [topology, setTopology] = useState<Topology | null | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (status !== "open") return;
    let active = true;
    fetchTopology()
      .then((value) => {
        if (active) setTopology(value);
      })
      .catch(() => {
        if (active) setTopology(null);
      });
    return () => {
      active = false;
    };
  }, [status, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  return { topology, reload };
}
