// サングラスくまのマスター画像の一覧（scripts/kuma-master-add.mjs が書く。手で直さない）。
// 社長の承認はここではなく、サーバーの保存場所に記録する（lib/kuma-master.js）。
export const MASTERS = [
  {
    "id": "full-front",
    "kind": "full",
    "file": "full-front.png",
    "format": "png",
    "width": 1141,
    "height": 1378,
    "bytes": 2819008,
    "sha256": "d12032a59253271b42cffd3f8120e4313272dd7ae5897cee79641473ab27486d",
    "addedAt": "2026-11-14",
    "checked": {
      "single": true,
      "noText": true,
      "noLogo": true,
      "by": "開発（目視）"
    },
    "note": "正面・全身。黒いパーカーは撮影用の衣装（固定しない）",
    "ownerSelected": {
      "at": "2026-11-14",
      "sha256": "d12032a59253271b42cffd3f8120e4313272dd7ae5897cee79641473ab27486d",
      "note": "社長がChatGPTで作成・選定した正式マスター"
    }
  },
  {
    "id": "upper-front",
    "kind": "front",
    "file": "upper-front.png",
    "format": "png",
    "width": 1312,
    "height": 1199,
    "bytes": 2503133,
    "sha256": "8d64faff72858964f2b1f413d4e1168f0d1c327344d6bd86b36610891a25c707",
    "addedAt": "2026-11-14",
    "checked": {
      "single": true,
      "noText": true,
      "noLogo": true,
      "by": "開発（目視）"
    },
    "note": "正面・上半身。黒いパーカーは撮影用の衣装（固定しない）",
    "ownerSelected": {
      "at": "2026-11-14",
      "sha256": "8d64faff72858964f2b1f413d4e1168f0d1c327344d6bd86b36610891a25c707",
      "note": "社長がChatGPTで作成・選定した正式マスター"
    }
  }
];
