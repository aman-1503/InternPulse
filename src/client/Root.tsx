import { useEffect, useState } from "react";
import { DemoApp } from "./demo/DemoApp";
import { ProductionApp } from "./production/ProductionApp";

/**
 * Structural production/demo split (PART 2). Production and demo are two
 * completely separate component trees — production never imports demo
 * identity state, and vice versa. Which tree mounts is decided purely by
 * whether the hash is under #/demo; nothing else about the split is
 * negotiable at runtime.
 */
export function Root() {
  const [isDemo, setIsDemo] = useState(() => window.location.hash.startsWith("#/demo"));

  useEffect(() => {
    const onHash = () => setIsDemo(window.location.hash.startsWith("#/demo"));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return isDemo ? <DemoApp /> : <ProductionApp />;
}
