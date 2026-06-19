import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import Voice from '@react-native-voice/voice';
import Tts from 'react-native-tts';

const DEFAULT_VOICE_LOCALE = 'en-US';
const VOICE_UNAVAILABLE_TITLE = 'Voice မရသေးပါ';
const VOICE_UNAVAILABLE_MESSAGE =
  'ဒီ emulator/device မှာ speech recognition service မရှိသေးပါ။ Google app/Google Speech Service ပါတဲ့ emulator သို့မဟုတ် phone နဲ့စမ်းပါ။ Text chat ကတော့ ဆက်သုံးလို့ရပါတယ်။';
const MICROPHONE_DENIED_MESSAGE =
  'Microphone permission မပေးထားလို့ voice command သုံးလို့မရသေးပါ။';

function isVoiceAvailable(value) {
  return value === true || value === 1 || value === '1';
}

async function requestAndroidMicrophonePermission() {
  if (Platform.OS !== 'android') return true;

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone permission',
      message: 'SmartRes needs microphone access for voice commands.',
      buttonPositive: 'Allow',
      buttonNegative: 'Cancel',
    },
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export default function useVoiceAssistant({
  locale = DEFAULT_VOICE_LOCALE,
  onSpeechText,
} = {}) {
  const [listening, setListening] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(null);
  const [voiceError, setVoiceError] = useState('');
  const mountedRef = useRef(false);
  const onSpeechTextRef = useRef(onSpeechText);

  useEffect(() => {
    onSpeechTextRef.current = onSpeechText;
  }, [onSpeechText]);

  const checkVoiceAvailability = useCallback(async () => {
    try {
      const available = isVoiceAvailable(await Voice.isAvailable());

      if (mountedRef.current) {
        setVoiceAvailable(available);
        setVoiceError(available ? '' : VOICE_UNAVAILABLE_MESSAGE);
      }

      return available;
    } catch (err) {
      if (mountedRef.current) {
        setVoiceAvailable(false);
        setVoiceError(VOICE_UNAVAILABLE_MESSAGE);
      }

      return false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const handleSpeechText = event => {
      const spokenText = event.value?.[0]?.trim();

      if (spokenText) {
        onSpeechTextRef.current?.(spokenText);
      }
    };

    Voice.onSpeechPartialResults = handleSpeechText;
    Voice.onSpeechResults = handleSpeechText;
    Voice.onSpeechEnd = () => {
      if (mountedRef.current) setListening(false);
    };
    Voice.onSpeechError = event => {
      if (mountedRef.current) {
        setListening(false);
        setVoiceError(event?.error?.message || VOICE_UNAVAILABLE_MESSAGE);
      }
    };

    checkVoiceAvailability();
    Tts.setDefaultRate(0.48).catch(() => {});
    Tts.setDefaultPitch(1).catch(() => {});

    return () => {
      mountedRef.current = false;
      Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
      Tts.stop().catch(() => {});
    };
  }, [checkVoiceAvailability]);

  const startListening = useCallback(async () => {
    try {
      await Tts.stop();

      const hasPermission = await requestAndroidMicrophonePermission();
      if (!hasPermission) {
        setVoiceError(MICROPHONE_DENIED_MESSAGE);
        Alert.alert('Microphone permission', MICROPHONE_DENIED_MESSAGE);
        return false;
      }

      const available =
        voiceAvailable === null ? await checkVoiceAvailability() : voiceAvailable;
      if (!available) {
        Alert.alert(VOICE_UNAVAILABLE_TITLE, VOICE_UNAVAILABLE_MESSAGE);
        return false;
      }

      setListening(true);
      await Voice.start(locale);
      setVoiceError('');
      return true;
    } catch (err) {
      setListening(false);
      await checkVoiceAvailability();
      setVoiceError(VOICE_UNAVAILABLE_MESSAGE);
      Alert.alert(VOICE_UNAVAILABLE_TITLE, VOICE_UNAVAILABLE_MESSAGE);
      return false;
    }
  }, [checkVoiceAvailability, locale, voiceAvailable]);

  const stopListening = useCallback(async () => {
    try {
      await Voice.stop();
    } finally {
      setListening(false);
    }
  }, []);

  const speak = useCallback(async text => {
    const trimmed = String(text || '').trim();

    if (!trimmed) return;

    try {
      await Tts.stop();
      Tts.speak(trimmed);
    } catch (err) {
      // Voice output is optional; text chat should keep working if TTS fails.
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    Tts.stop().catch(() => {});
  }, []);

  return {
    listening,
    voiceAvailable,
    voiceError,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
