import MenuScreen from './MenuScreen';
import ThreeViewer from './ThreeViewer';
import { appScreen } from '../store/app';

export default function App() {
    if (appScreen.value === 'game') {
        return <ThreeViewer />;
    }

    return <MenuScreen />;
}
