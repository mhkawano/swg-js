/**
 * Copyright 2018 The Subscribe with Google Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ExperimentFlags} from './experiment-flags';
import {PageConfig} from '../model/page-config';
import {Storage, pruneTimestamps} from './storage';
import {StorageKeysWithoutPublicationIdSuffix} from '../utils/constants';
import {setExperimentsStringForTesting} from '../runtime/experiments';

class WebStorageStub {
  getItem(unusedKey) {}
  setItem(unusedKey, unusedValue) {}
  removeItem(unusedKey) {}
}

describes.realWin('Storage', (env) => {
  let win;
  let sessionStorageMock;
  let localStorageMock;
  let storage;
  let pageConfig;
  const productId = 'pubId:label1';

  beforeEach(() => {
    win = env.win;
    const sessionStorage = new WebStorageStub();
    sessionStorageMock = sandbox.mock(sessionStorage);
    Object.defineProperty(win, 'sessionStorage', {value: sessionStorage});
    const localStorage = new WebStorageStub();
    localStorageMock = sandbox.mock(localStorage);
    Object.defineProperty(win, 'localStorage', {value: localStorage});
    pageConfig = new PageConfig(productId);

    storage = new Storage(win, pageConfig);
    setExperimentsStringForTesting('');
  });

  describe('Session storage', () => {
    beforeEach(() => {
      localStorageMock.expects('getItem').never();
      localStorageMock.expects('setItem').never();
      localStorageMock.expects('removeItem').never();
    });

    afterEach(() => {
      localStorageMock.verify();
      sessionStorageMock.verify();
    });

    describe('if not available', () => {
      it('get should return null', () => {
        Object.defineProperty(win, 'sessionStorage', {value: null});
        sessionStorageMock.expects('getItem').never();
        expect(storage.get('baseKey')).to.be.null;
      });

      it('set should store the value in the instance variable', () => {
        sessionStorageMock.expects('getItem').never();
        sessionStorageMock.expects('setItem').never();
        Object.defineProperty(win, 'sessionStorage', {value: null});
        storage.set('baseKey', 'one');

        expect(storage.get('baseKey')).to.equal('one');
      });

      it('remove should remove the value from the instance variable', () => {
        sessionStorageMock.expects('getItem').never();
        sessionStorageMock.expects('removeItem').never();
        Object.defineProperty(win, 'sessionStorage', {value: null});
        storage.set('baseKey', 'one');
        storage.remove('baseKey');

        expect(storage.get('baseKey')).to.be.null;
      });
    });

    describe('no value for new key', () => {
      beforeEach(() => {
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
      });

      it('should return fresh value from the storage', () => {
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns('one')
          .once();

        expect(storage.get('baseKey')).to.equal('one');
      });

      it('should return null value if not in the storage', () => {
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();

        expect(storage.get('baseKey')).to.be.null;
      });

      it('should set a value', () => {
        sessionStorageMock
          .expects('setItem')
          .withExactArgs('subscribe.google.com:baseKey', 'one')
          .once();
        storage.set('baseKey', 'one');

        expect(storage.get('baseKey')).to.equal('one');
      });

      it('should set a value with failing storage', () => {
        sessionStorageMock
          .expects('setItem')
          .withExactArgs('subscribe.google.com:baseKey', 'one')
          .throws(new Error('intentional'))
          .once();
        storage.set('baseKey', 'one');

        expect(storage.get('baseKey')).to.equal('one');
      });

      it('should remove a value', () => {
        storage.set('baseKey', 'one');
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();
        sessionStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .once();
        storage.remove('baseKey');

        expect(storage.get('baseKey')).to.be.null;
      });

      it('should return null value if storage fails', () => {
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .throws(new Error('intentional'))
          .once();

        expect(storage.get('baseKey')).to.be.null;
      });

      it('should remove a value with failing storage', () => {
        sessionStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .throws(new Error('intentional'))
          .once();
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();
        storage.set('baseKey', 'one');
        storage.remove('baseKey');

        expect(storage.get('baseKey')).to.be.null;
      });
    });

    describe('with value present for new key', () => {
      beforeEach(() => {
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .returns('originalValue_newKey')
          .once();
      });

      it('should return value using new key', () => {
        sessionStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();

        expect(storage.get('baseKey')).to.equal('originalValue_newKey');
      });

      it('should set a value using new key', () => {
        // Old key should no longer be used to access storage.
        sessionStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();
        sessionStorageMock
          .expects('setItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();

        // Internal implementation of storage.set should clear storage value with old key if present.
        sessionStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .once();
        sessionStorageMock
          .expects('setItem')
          .withExactArgs(
            'subscribe.google.com:baseKey:pubId',
            'newValue_newKey'
          )
          .once();

        storage.set('baseKey', 'newValue_newKey');

        expect(storage.get('baseKey')).to.equal('newValue_newKey');
      });

      it('should remove a value using new key', () => {
        sessionStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .once();

        storage.remove('baseKey');

        sessionStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
        sessionStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();

        expect(storage.get('baseKey')).to.be.null;
      });
    });

    describe('no value for new key but experiment enabled', () => {
      beforeEach(() => {
        setExperimentsStringForTesting(
          ExperimentFlags.ENABLE_PUBLICATION_ID_SUFFIX_FOR_STORAGE_KEY
        );
      });

      it('should return null value if not in the storage', () => {
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();

        expect(storage.get('baseKey')).to.be.null;
      });

      it('should set a value using new key', () => {
        sessionStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
        // Old key should no longer be used to access storage.
        sessionStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();
        sessionStorageMock
          .expects('setItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();

        // Internal implementation of storage.set should clear storage value with old key if present.
        sessionStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .once();
        sessionStorageMock
          .expects('setItem')
          .withExactArgs(
            'subscribe.google.com:baseKey:pubId',
            'newValue_newKey'
          )
          .once();

        storage.set('baseKey', 'newValue_newKey');

        expect(storage.get('baseKey')).to.equal('newValue_newKey');
      });

      it('should remove a value using new key', () => {
        sessionStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .once();

        storage.remove('baseKey');

        sessionStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
        sessionStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();

        expect(storage.get('baseKey')).to.be.null;
      });

      it('should use old key if the baseKey belongs to StorageKeysWithoutPublicationIdSuffix', () => {
        sessionStorageMock
          .expects('getItem')
          .withExactArgs(
            `subscribe.google.com:${StorageKeysWithoutPublicationIdSuffix.PPS_TAXONOMIES}`
          )
          .returns(null)
          .once();
        sessionStorageMock
          .expects('getItem')
          .withExactArgs(
            `subscribe.google.com:${StorageKeysWithoutPublicationIdSuffix.PPS_TAXONOMIES}:pubId`
          )
          .never();

        expect(
          storage.get(StorageKeysWithoutPublicationIdSuffix.PPS_TAXONOMIES)
        ).to.be.null;
      });
    });
  });

  describe('Local storage', () => {
    beforeEach(() => {
      sessionStorageMock.expects('getItem').never();
      sessionStorageMock.expects('setItem').never();
      sessionStorageMock.expects('removeItem').never();
    });

    afterEach(() => {
      sessionStorageMock.verify();
      localStorageMock.verify();
    });

    describe('if not available', () => {
      it('get should return null', () => {
        Object.defineProperty(win, 'localStorage', {value: null});
        localStorageMock.expects('getItem').never();
        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.be.null;
      });

      it('set should store the value in the instance variable', () => {
        localStorageMock.expects('getItem').never();
        localStorageMock.expects('setItem').never();
        Object.defineProperty(win, 'localStorage', {value: null});
        storage.set('baseKey', 'one', /* useLocalStorage */ true);

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.equal(
          'one'
        );
      });

      it('remove should remove the value from the instance variable', () => {
        localStorageMock.expects('getItem').never();
        localStorageMock.expects('removeItem').never();
        Object.defineProperty(win, 'localStorage', {value: null});
        storage.set('baseKey', 'one', /* useLocalStorage */ true);
        storage.remove('baseKey', /* useLocalStorage */ true);

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.be.null;
      });
    });

    describe('no value for new key', () => {
      beforeEach(() => {
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
      });

      it('should return fresh value from the storage', () => {
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns('one')
          .once();

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.equal(
          'one'
        );
      });

      it('should return null value if not in the storage', () => {
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.be.null;
      });

      it('should return null value if storage fails', () => {
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .throws(new Error('intentional'))
          .once();

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.be.null;
      });

      it('should set a value', () => {
        localStorageMock
          .expects('setItem')
          .withExactArgs('subscribe.google.com:baseKey', 'one')
          .once();
        storage.set('baseKey', 'one', /* useLocalStorage */ true);

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.equal(
          'one'
        );
      });

      it('should set a value with failing storage', () => {
        localStorageMock
          .expects('setItem')
          .withExactArgs('subscribe.google.com:baseKey', 'one')
          .throws(new Error('intentional'))
          .once();
        storage.set('baseKey', 'one', /* useLocalStorage */ true);

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.equal(
          'one'
        );
      });

      it('should remove a value', () => {
        storage.set('baseKey', 'one', /* useLocalStorage */ true);
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();
        localStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .once();
        storage.remove('baseKey', /* useLocalStorage */ true);

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.be.null;
      });

      it('should remove a value with failing storage', () => {
        localStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .throws(new Error('intentional'))
          .once();
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();
        storage.set('baseKey', 'one', /* useLocalStorage */ true);
        storage.remove('baseKey', /* useLocalStorage */ true);

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.be.null;
      });
    });

    describe('with value present for new key', () => {
      beforeEach(() => {
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .returns('originalValue_newKey')
          .once();
      });

      it('should return value using new key', () => {
        localStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.equal(
          'originalValue_newKey'
        );
      });

      it('should set a value using new key', () => {
        // Old key should no longer be used to access storage.
        localStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();
        localStorageMock
          .expects('setItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();

        // Internal implementation of storage.set should clear storage value with old key if present.
        localStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .once();
        localStorageMock
          .expects('setItem')
          .withExactArgs(
            'subscribe.google.com:baseKey:pubId',
            'newValue_newKey'
          )
          .once();

        storage.set('baseKey', 'newValue_newKey', /* useLocalStorage */ true);

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.equal(
          'newValue_newKey'
        );
      });

      it('should remove a value using new key', () => {
        localStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .once();

        storage.remove('baseKey', /* useLocalStorage */ true);

        localStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
        localStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.be.null;
      });
    });

    describe('no value for new key but experiment enabled', () => {
      beforeEach(() => {
        setExperimentsStringForTesting(
          ExperimentFlags.ENABLE_PUBLICATION_ID_SUFFIX_FOR_STORAGE_KEY
        );
      });

      it('should return null value if not in the storage', () => {
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.be.null;
      });

      it('should set a value using new key', () => {
        localStorageMock
          .expects('getItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
        // Old key should no longer be used to access storage.
        localStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();
        localStorageMock
          .expects('setItem')
          .withArgs('subscribe.google.com:baseKey')
          .never();

        // Internal implementation of storage.set should clear storage value with old key if present.
        localStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey')
          .once();
        localStorageMock
          .expects('setItem')
          .withExactArgs(
            'subscribe.google.com:baseKey:pubId',
            'newValue_newKey'
          )
          .once();

        storage.set('baseKey', 'newValue_newKey', /* useLocalStorage */ true);

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.equal(
          'newValue_newKey'
        );
      });

      it('should remove a value using new key', () => {
        localStorageMock
          .expects('removeItem')
          .withExactArgs('subscribe.google.com:baseKey:pubId')
          .once();

        storage.remove('baseKey', /* useLocalStorage */ true);

        localStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey:pubId')
          .returns(null)
          .once();
        localStorageMock
          .expects('getItem')
          .withArgs('subscribe.google.com:baseKey')
          .returns(null)
          .once();

        expect(storage.get('baseKey', /* useLocalStorage */ true)).to.be.null;
      });

      it('should use old key if the baseKey belongs to StorageKeysWithoutPublicationIdSuffix', () => {
        localStorageMock
          .expects('getItem')
          .withExactArgs(
            `subscribe.google.com:${StorageKeysWithoutPublicationIdSuffix.PPS_TAXONOMIES}`
          )
          .returns(null)
          .once();
        localStorageMock
          .expects('getItem')
          .withExactArgs(
            `subscribe.google.com:${StorageKeysWithoutPublicationIdSuffix.PPS_TAXONOMIES}:pubId`
          )
          .never();

        expect(
          storage.get(
            StorageKeysWithoutPublicationIdSuffix.PPS_TAXONOMIES,
            /* useLocalStorage */ true
          )
        ).to.be.null;
      });
    });
  });

  describe('pruneTimestamps', () => {
    beforeEach(() => {
      sandbox.stub(Date, 'now').returns(3500);
    });

    function arraysAreEqual(arr1, arr2) {
      if (arr1.length !== arr2.length) {
        return false;
      }
      return arr1.every((value, index) => value === arr2[index]);
    }

    it('should prune timestamps', () => {
      const result = pruneTimestamps(
        [1000, 2000, 3000, 4000],
        /* timestampLifespan= */ 1000
      );
      expect(arraysAreEqual(result, [3000, 4000])).to.be.true;
    });
  });
});
