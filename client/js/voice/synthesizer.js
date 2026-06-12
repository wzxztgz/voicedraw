/**
 * 语音合成反馈
 * 使用浏览器原生 SpeechSynthesis API，零延迟
 */

class VoiceSynthesizer {
  constructor() {
    this.synth = window.speechSynthesis;
    this.currentUtterance = null;
    this.isEnabled = true;
    this.voice = null;
    this.rate = 1.1;    // 语速
    this.pitch = 1.0;   // 音调
    this.volume = 0.8;  // 音量

    this._initVoice();
  }

  /**
   * 初始化中文语音
   */
  _initVoice() {
    const setVoice = () => {
      const voices = this.synth.getVoices();
      // 优先选择中文语音
      this.voice = voices.find((v) => v.lang.startsWith('zh-CN') && v.localService) ||
                   voices.find((v) => v.lang.startsWith('zh-CN')) ||
                   voices.find((v) => v.lang.startsWith('zh')) ||
                   null;
    };

    setVoice();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = setVoice;
    }
  }

  /**
   * 播报文本（异步，不阻塞视觉反馈）
   */
  speak(text) {
    if (!this.isEnabled || !text) return;

    // 打断当前播报
    this.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = this.rate;
    utterance.pitch = this.pitch;
    utterance.volume = this.volume;
    utterance.lang = 'zh-CN';

    this.currentUtterance = utterance;
    this.synth.speak(utterance);
  }

  /**
   * 打断当前播报
   */
  stop() {
    this.synth.cancel();
    this.currentUtterance = null;
  }

  /**
   * 启用/禁用语音反馈
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled) this.stop();
  }

  /**
   * 获取所有可用语音
   */
  getVoices() {
    return this.synth.getVoices().filter((v) => v.lang.startsWith('zh'));
  }
}

export default new VoiceSynthesizer();
