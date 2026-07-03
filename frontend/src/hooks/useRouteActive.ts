import { useLocation } from "react-router-dom";

/** Pure route-prefix matcher (exact or nested segment). */
export function matchRoutePrefix(pathname: string, pathPrefix: string): boolean {
  if (pathPrefix === "/") return pathname === "/";
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

/** True when the current pathname matches a route prefix (exact or nested). */
export function useRouteActive(pathPrefix: string): boolean {
  const { pathname } = useLocation();
  return matchRoutePrefix(pathname, pathPrefix);
}
