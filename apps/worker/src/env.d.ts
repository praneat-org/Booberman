declare namespace Cloudflare {
  interface Env {
    ROOM: DurableObjectNamespace<import('./room/RoomDO').RoomDO>;
  }
  interface GlobalProps {
    mainModule: typeof import('./index');
    durableNamespaces: 'RoomDO';
  }
}
