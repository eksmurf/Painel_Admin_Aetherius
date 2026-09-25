import { MsgType } from '../../messages';
import { localIdToRemoteId } from '../../view/worldViewMisc';
import { ClientListener, CombinedController, Sp } from './clientListener';

// Adapted from Alduinak AdminModeService/EmoteService. Only server-issued commands,
// scheduled onto update, can call natives. There is no browser-to-console bridge.
export class AdminToolsService extends ClientListener {
  private modes: Record<string, any> = {};
  private modeExpiry = 0;
  private weatherExpiry = 0;
  private weatherDescriptor: string | null = null;
  private speedBase: number | null = null;
  private collisionsDisabled = false;
  private cache = new Map<string, any>();
  constructor(private sp: Sp, private controller: CombinedController) {
    super();
    controller.emitter.on('customPacketMessage', (e: any) => {
      let packet: any;
      try { packet = JSON.parse(e.message.contentJsonDump); } catch { return; }
      if (packet.customPacketType !== 'aetheriusAdminCommand' || typeof packet.token !== 'string') return;
      controller.once('update', () => this.execute(packet));
    });
    controller.on('update', () => {
      if (this.modeExpiry && Date.now() >= this.modeExpiry) this.resetModes();
      if (this.weatherExpiry && Date.now() >= this.weatherExpiry) this.weather(null, 0);
    });
    const reset = () => controller.once('update', () => { this.resetModes(); this.weather(null, 0); this.cache.clear(); });
    controller.emitter.on('connectionDisconnect', reset);
    controller.emitter.on('connectionAccepted', reset);
    controller.emitter.on('applyDeathStateEvent', (e: any) => { if (e.isDead && e.actor?.getFormID() === 0x14) reset(); });
  }
  private reply(token: string, data: any) {
    this.controller.emitter.emit('sendMessage', {
      message: { t: MsgType.CustomPacket, contentJsonDump: JSON.stringify({ type: 'admin:clientResult', data: { token, ...data } }) }, reliability: 'reliable'
    });
  }
  private execute(packet: any) {
    if (this.cache.has(packet.token)) { this.reply(packet.token, this.cache.get(packet.token)); return; }
    let response: any;
    try {
      const data = packet.data || {}, player = this.sp.Game.getPlayer();
      if (!player) throw Error('Jogador ainda não carregado');
      let result: any = {};
      switch (packet.command) {
        case 'probe': {
          const ref = this.sp.Game.getCurrentCrosshairRef();
          result = ref ? { localFormId: ref.getFormID(), serverFormId: localIdToRemoteId(ref.getFormID(), true), baseFormId: ref.getBaseObject()?.getFormID(), name: ref.getBaseObject()?.getName(), position: [ref.getPositionX(), ref.getPositionY(), ref.getPositionZ()], cell: ref.getParentCell()?.getFormID() } : { crosshair: null };
          break;
        }
        case 'animation': {
          const allowed = ['IdleStop','IdleWave','IdleSilentBow','IdleApplaud2','IdleCivilWarCheer','IdleSalute','IdleSurrender','IdleHandsBehindBack','IdleWarmHandsStanding'];
          if (!allowed.includes(data.animation)) throw Error('Animação fora do catálogo');
          this.sp.Debug.sendAnimationEvent(player, data.animation);
          break;
        }
        case 'modes':
          if (data.cameraLocation) throw Error('Câmera aceita somente o próprio operador');
          this.applyModes(data.values, data.leaseMs); break;
        case 'weather': this.weather(data.descriptor, data.leaseMs); break;
        default: throw Error('Comando desconhecido');
      }
      response = { ok: true, result };
    } catch (error) { response = { ok: false, error: String(error).slice(0,200) }; }
    this.complete(packet.token,response);
  }
  private complete(token: string, response: any) {
    this.cache.set(token, response);
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value);
    this.reply(token, response);
  }
  private applyModes(values: Record<string, any>, leaseMs: number) {
    if (!values || typeof values !== 'object' || !Number.isFinite(leaseMs) || leaseMs < 0 || leaseMs > 20000 || Object.keys(values).some(k => !['god','ghost','invisible','speed','noclip','freecam'].includes(k))) throw Error('Modos inválidos');
    const player = this.sp.Game.getPlayer();
    if (!player) throw Error('Jogador indisponível');
    const api = this.sp as Sp & { setFreeCameraMode?: (on: boolean) => boolean };
    if (values.freecam && !api.setFreeCameraMode) throw Error('A DLL instalada não oferece câmera livre');
    if (values.speed !== undefined && (!Number.isInteger(values.speed) || values.speed < 25 || values.speed > 500)) throw Error('Velocidade inválida');
    // Keep ownership before natives: a partial exception is also rolled back on lease expiry.
    const previous = this.modes; this.modes = { ...previous, ...values }; this.modeExpiry = Date.now() + Math.max(1000,leaseMs);
    this.sp.Debug.setGodMode(!!values.god);
    player.setGhost(!!values.ghost);
    player.setAlpha(values.invisible ? 0 : values.ghost ? 0.35 : 1, false);
    if (this.collisionsDisabled !== !!values.noclip) { this.sp.Debug.toggleCollisions(); this.collisionsDisabled = !!values.noclip; }
    if (values.speed !== undefined) {
      if (this.speedBase === null) this.speedBase = player.getBaseActorValue('SpeedMult');
      player.setActorValue('SpeedMult', values.speed);
    } else if (this.speedBase !== null) { player.setActorValue('SpeedMult', this.speedBase); this.speedBase = null; }
    if (values.freecam || previous.freecam) {
      if (api.setFreeCameraMode?.(!!values.freecam) !== !!values.freecam) throw Error('Câmera não confirmou o estado');
    }
    this.modes = { ...values };
    this.modeExpiry = Object.keys(values).length ? Date.now() + leaseMs : 0;
  }
  private resetModes() {
    try { this.applyModes({}, 0); } catch { this.modeExpiry = Date.now() + 1000; }
  }
  private weather(descriptor: string | null, leaseMs: number) {
    if (descriptor === null) {
      if (this.weatherDescriptor) this.sp.Weather.releaseOverride();
      this.weatherDescriptor = null; this.weatherExpiry = 0; return;
    }
    if (typeof descriptor !== 'string' || !/^[0-9a-f]+:[^:\r\n]+\.(esm|esp|esl)$/i.test(descriptor) || !Number.isFinite(leaseMs) || leaseMs < 1000 || leaseMs > 30000) throw Error('Clima inválido');
    const at = descriptor.indexOf(':');
    const form = this.sp.Game.getFormFromFile(parseInt(descriptor.slice(0,at),16), descriptor.slice(at+1));
    const weather = this.sp.Weather.from(form);
    if (!weather) throw Error('Clima não existe no cliente');
    if (this.weatherDescriptor !== descriptor) weather.forceActive(true);
    this.weatherDescriptor = descriptor; this.weatherExpiry = Date.now() + leaseMs;
  }
}
