import { QualityIssue } from "../types";

export function validateFactLite(content: string): QualityIssue[] {
  if (/革命性|颠覆性|保证成功|永远正确/u.test(content)) {
    return [
      {
        check: "fact_lite.overclaim",
        severity: "warning",
        message: "内容包含过度断言或营销式表达。",
        suggestion: "改为具体说明适用条件和限制。",
      },
    ];
  }

  return [];
}
