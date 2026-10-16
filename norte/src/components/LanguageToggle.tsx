import type { Language } from "../lib/types";

type Props = {
  language: Language;
  onChange: (language: Language) => void;
};

export function LanguageToggle({ language, onChange }: Props) {
  return (
    <div className="language-toggle" aria-label="Language selector">
      <button className={language === "pt" ? "active" : ""} onClick={() => onChange("pt")}>PT</button>
      <span>/</span>
      <button className={language === "en" ? "active" : ""} onClick={() => onChange("en")}>EN</button>
    </div>
  );
}
