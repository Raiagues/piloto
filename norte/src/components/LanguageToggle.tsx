import type { Language } from "../lib/types";

type Props = {
  language: Language;
  onChange: (language: Language) => void;
};

export function LanguageToggle({ language, onChange }: Props) {
  return (
    <div className="language-toggle" role="group" aria-label={language === "pt" ? "Idioma" : "Language"}>
      {(["pt", "en"] as const).map(value => <button key={value} type="button" aria-pressed={language === value} lang={value === "pt" ? "pt-BR" : "en"} title={value === "pt" ? "Português" : "English"} onClick={() => language !== value && onChange(value)}>{value.toUpperCase()}</button>)}
    </div>
  );
}
