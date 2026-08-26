declare namespace IINA {
  interface SubTandemRuntimeAugmentation {
    core?: API.Core;
    event?: API.Event;
    file?: API.File;
    global?: API.Global;
    http?: API.HTTP;
    mpv?: API.MPV;
    overlay?: API.Overlay;
    preferences?: API.Preferences;
    sidebar?: API.SidebarView;
    utils?: API.Utils;
  }

  interface SubTandemMpvSubtitleTrackNode {
    type: "sub";
    id: number;
    selected: boolean;
    "main-selection": number;
    external: boolean;
    codec?: string;
    "ff-index"?: number;
    "src-id"?: number;
    lang?: string;
    title?: string;
  }

  interface SubTandemOsdDimensions {
    w?: number;
    h?: number;
    ml?: number;
    mr?: number;
    mt?: number;
    mb?: number;
  }
}
