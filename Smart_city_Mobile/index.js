import 'react-native-gesture-handler';
import { enableScreens } from 'react-native-screens';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

enableScreens();

Ionicons.loadFont()
  .catch(() => null)
  .finally(() => {
    AppRegistry.registerComponent(appName, () => App);
  });
