// 증권사 목록 및 수수료율 설정 공통 파일

export const US_BROKERS = [
  { key: "commissionNH",         label: "NH투자증권",    defaultRate: "0.25" },
  { key: "commissionMiraeasset", label: "미래에셋증권",  defaultRate: "0.25" },
  { key: "commissionKiwoom",     label: "키움증권",      defaultRate: "0.25" },
  { key: "commissionSamsung",    label: "삼성증권",      defaultRate: "0.25" },
  { key: "commissionHantu",      label: "한국투자증권",  defaultRate: "0.25" },
  { key: "commissionKb",         label: "KB증권",        defaultRate: "0.25" },
  { key: "commissionToss",       label: "토스증권",      defaultRate: "0.25" },
] as const;

export const KR_BROKERS = [
  { key: "commissionKrNH",         label: "NH투자증권",   defaultRate: "0.015" },
  { key: "commissionKrMiraeasset", label: "미래에셋증권", defaultRate: "0.015" },
  { key: "commissionKrKiwoom",     label: "키움증권",     defaultRate: "0.015" },
  { key: "commissionKrSamsung",    label: "삼성증권",     defaultRate: "0.015" },
  { key: "commissionKrHantu",      label: "한국투자증권", defaultRate: "0.015" },
  { key: "commissionKrKb",         label: "KB증권",       defaultRate: "0.015" },
  { key: "commissionKrToss",       label: "토스증권",     defaultRate: "0.015" },
] as const;

export type UsBrokerKey = (typeof US_BROKERS)[number]["key"];
export type KrBrokerKey = (typeof KR_BROKERS)[number]["key"];
