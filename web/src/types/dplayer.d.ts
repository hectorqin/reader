declare module 'dplayer' {
  interface DPlayerOptions { container:HTMLElement; video:{url:string;type?:string}; lang?:string; autoplay?:boolean; loop?:boolean; mutex?:boolean; hotkey?:boolean; theme?:string; contextmenu?:unknown[] }
  export default class DPlayer {
    constructor(options:DPlayerOptions);
    video:HTMLVideoElement;
    template:{video:HTMLVideoElement};
    initVideo(video:HTMLVideoElement,type:string):void;
    toggle():void;
    destroy():void;
  }
}
