import { onValue, off, ref } from 'firebase/database';
import { database } from '../utils/firebase';

const subscribeToPath = (path, callback) => {
  if (!database) {
    callback?.({});
    return () => {};
  }

  const targetRef = ref(database, path);
  const handler = (snapshot) => {
    const value = snapshot?.exists() ? snapshot.val() : {};
    callback?.(value);
  };

  onValue(targetRef, handler);
  return () => off(targetRef, 'value', handler);
};

const subscribeAllDealerConfigs = (callback) => subscribeToPath('dealerConfigs', callback);
const subscribeToPGIRecords = (callback) => subscribeToPath('pgirecord', callback);

export { database, subscribeAllDealerConfigs, subscribeToPGIRecords };
