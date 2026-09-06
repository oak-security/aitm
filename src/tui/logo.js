export const LOGO = String.raw`    _    ___ _____ __  __
   / \  |_ _|_   _|  \/  |    o-----o
  / _ \  | |  | | | |\/| |    |\   /|
 / ___ \ | |  | | | |  | |    | o-o |
/_/   \_\___| |_| |_|  |_|    o-----o`;
export const TAGLINE = 'AI Threat Modeller  /  TRACE  /  by Oak Security';
export const terminalText = (value) =>
  String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
