export type Appearance = { theme: "system" | "light" | "dark"; reducedMotion: boolean; contrast: "standard" | "high"; density: "comfortable" | "compact"; textSize: "standard" | "large" };
export const defaultAppearance: Appearance = { theme: "system", reducedMotion: false, contrast: "standard", density: "comfortable", textSize: "standard" };
export const nextTheme = (theme: Appearance["theme"]): Appearance["theme"] => theme === "system" ? "light" : theme === "light" ? "dark" : "system";
export function applyAppearance(value: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = value.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : value.theme;
  root.dataset.motion = value.reducedMotion ? "reduced" : "system";
  root.dataset.contrast = value.contrast;
  root.dataset.density = value.density;
  root.dataset.textSize = value.textSize;
}
export const appearanceBootstrap = `(function(){try{var p=JSON.parse(localStorage.getItem('surveynt:appearance')||'{}'),r=document.documentElement;r.dataset.theme=p.theme==='dark'||(p.theme!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';r.dataset.motion=p.reducedMotion?'reduced':'system';r.dataset.contrast=p.contrast||'standard';r.dataset.density=p.density||'comfortable';r.dataset.textSize=p.textSize||'standard'}catch(e){}})();`;
