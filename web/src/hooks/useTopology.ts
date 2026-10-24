import { useEffect, useState } from "react";
import { fetchTopology, type Topology } from "@/lib/api";

/**
 * 拓扑在运行期不变，只取一次。undefined = 还在加载，null = 点表没配 topology。
 * 加载失败时保持 null，前端会退化成按 place 合成四条管段。
 */
export function useTopology() {
  const [topology, setTopology] = useState<Topology | null | undefined>(undefined);

  useEffect(() => {
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
  }, []);

  return topology;
}
