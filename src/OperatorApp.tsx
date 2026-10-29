import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import { OperatorView } from "./ui/operator/OperatorView";

export function OperatorApp() {
  const [districts, setDistricts] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/districts.geojson`)
      .then((r) => r.json())
      .then(setDistricts)
      .catch(() => setDistricts(null));
  }, []);
  return <OperatorView districts={districts} />;
}
