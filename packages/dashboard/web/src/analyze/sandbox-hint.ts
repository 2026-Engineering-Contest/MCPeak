/**
 * 원격 대상에 격리를 켤 수 없다는 안내. 사용자 모드 사전 점검(`PreCheck.tsx`)이 쓴다. 개발자 모드 Analyze 는
 * 점검 옵션이 없어(ADR-0117) 이 문장을 쓰지 않는다.
 */
export const REMOTE_SANDBOX_HINT =
  "원격 서버는 격리할 수 없습니다. 격리는 프로세스를 띄우는 대상에만 적용됩니다.";
