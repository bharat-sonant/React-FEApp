import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/theme';
import CitySelectionScreen from '../Screens/CitySelection/CitySelectionScreen';
import LoginScreen from '../Screens/Login/LoginScreen';
import DashboardScreen from '../Screens/Dashboard/DashboardScreen';
import TaskExecutionScreen from '../Screens/TaskForm/TaskExecutionScreen';
import CameraScreen from '../Screens/Camera/CameraScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
};

const RootNavigator = ({ initialRoute = 'Login' }) => (
  <NavigationContainer theme={navTheme}>
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    >
      {/* City is now derived from the login id (AJM101 → Ajmer); the
          CitySelection screen is kept registered but out of the default flow. */}
      <Stack.Screen name="CitySelection" component={CitySelectionScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen
        name="TaskExecution"
        component={TaskExecutionScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="Camera"
        component={CameraScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  </NavigationContainer>
);

export default RootNavigator;
