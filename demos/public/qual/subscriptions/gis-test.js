/* eslint-disable */
/**
 * Copyright 2026 The Subscribe with Google Authors. All Rights Reserved.
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

function init() {
  window.addEventListener('message', messageHandler);
}

function messageHandler(e) {
  if (typeof e.data.type === 'string' && e.data.type.startsWith('RRM_GIS')) {
    log(JSON.stringify(e.data));
  }
}

function initGis() {
  google.accounts.id.initialize({
    client_id: '365425805315-ulc9hop6lvq3blgc7ubvtcu5322t3fcn.apps.googleusercontent.com',
    callback: gisCallback,
    rrm_interop: true,
    rrm_iframe_path: 'https://subscribe-qual.sandbox.google.com/swg/ui/v1/rrmgisinterop'
  });
  google.accounts.id.renderButton(document.getElementById('gisButton'), {
    type: 'standard',
    theme: 'light',
    size: 'large',
  });
  log(`Called initGis`);
}

function gisCallback(response) {
  log(`gisCallback ${JSON.stringify(response)}`);
}

function initRrms() {
  const isAccessibleForFree = document.getElementById('isAccessibleForFree').checked;
  const productId = document.getElementById('productId').value;
  (self.SWG_BASIC = self.SWG_BASIC || []).push((basicSubscriptions) => {
    basicSubscriptions.setOnEntitlementsResponse((response) => {
      log(`Entitlements response: ${JSON.stringify(response)}`);
    });
    basicSubscriptions.init({
      type: "NewsArticle",
      isPartOfType: ["Product"],
      isPartOfProductId: productId,
      isAccessibleForFree: isAccessibleForFree,
      clientOptions: {
        theme: "light",
        lang: "en",
      },
      gisInterop: true,
    });
  });
  log(`Called initRrms with isAccessibleForFree: ${isAccessibleForFree} and productId: ${productId}`);
}

function addResultRow(type, result) {
  const table = document.getElementById("resultTable");
  const row = document.createElement('tr');
  let html;
  if (type == 'TYPE_REGISTRATION_WALL') {
    html = `
            <td scope="col">${result.configurationId}</td>
            <td scope="col">${type}</td>
            <td scope="col">${result.data.email}</td>
            <td scope="col">${result.data.displayName}</td>
            <td scope="col">${result.data.givenName}</td>
            <td scope="col">${result.data.familyName}</td>
          `;
  } else {
    html = `
            <td scope="col">${result.configurationId}</td>
            <td scope="col">${type}</td>
          `;
  }
  row.innerHTML = html;
  table.appendChild(row);
}

function addInterventionRow(intervention) {
  const table = document.getElementById("interventionTable");
  const row = document.createElement('tr');
  const html = `
          <td scope="col"><button>Show</button></td>
          <td scope="col">${intervention.type}</td>
          <td scope="col">${intervention.configurationId}</td>
        `;
  row.innerHTML = html;
  const button = row.getElementsByTagName('button')[0];
  button.onclick = () => {
    const isClosable = document.getElementById("isClosable").checked;
    const suppressToast = document.getElementById("suppressToast").checked;
    const onAlternateAction = document.getElementById("onAlternateAction").checked;
    const onSignIn = document.getElementById("onSignIn").checked;
    intervention.show({
      isClosable,
      onResult: (result) => addResultRow(intervention.type, result),
      suppressToast,
      onAlternateAction: onAlternateAction ? () => alert('buy flow launched') : null,
      onSignIn: onSignIn ? () => alert('sign in flow launched') : null,
    });
  }
  table.appendChild(row);
}

function initRrme() {
  const html = `
    <style>
      table {
        width: 100%;
      }
      caption  {
        font-size: 200%;
      }
    </style>
    <input type="checkbox" id="isClosable" name="scales" checked />
    <label for="isClosable">isClosable</label>
    </input>
    <input type="checkbox" id="suppressToast" name="scales" checked />
    <label for="suppressToast">suppressToast</label>
    </input>
    <input type="checkbox" id="onAlternateAction" name="scales" checked />
    <label for="onAlternateAction">onAlternateAction</label>
    </input>
    <input type="checkbox" id="onSignIn" name="scales" checked />
    <label for="onSignIn">onSignIn</label>
    </input>
    </div>
    <table>
      <caption>Available Interventions</caption>
      <thead>
        <tr>
          <th scope="col">Activate</th>
          <th scope="col">Type</th>
          <th scope="col">ID</th>
        </tr>
      </thead>
      <tbody id="interventionTable">
      </tbody>
    </table>
    <br />
    <table>
      <caption>Intervention Results</caption>
      <thead>
        <tr>
          <th scope="col">ID</th>
          <th scope="col">Type</th>
        </tr>
      </thead>
      <tbody id="resultTable">
      </tbody>
    </table>
  `;
  document.getElementById('availableInterventions').innerHTML = html;

  const isAccessibleForFree = document.getElementById('isAccessibleForFree').checked;
  const productId = document.getElementById('productId').value;
  (self.SWG = self.SWG || []).push(async (subscriptions) => {
    subscriptions.setOnEntitlementsResponse((response) => {
      log(`Entitlements response: ${JSON.stringify(response)}`);
    });
    subscriptions.configure({ gisInterop: true, });
    subscriptions.init(productId);

    const availableInterventions = await subscriptions.getAvailableInterventions();
    availableInterventions.forEach(addInterventionRow);
  });
}

function showOneTap() {
  google.accounts.id.prompt();
}

function addIframe() {
  const container = document.getElementById('iframeContainer');
  const iframe = document.createElement('iframe');

  const url = new URL(window.location.href);
  url.searchParams.set('framed', '1');
  if (document.getElementById('crossOrigin').checked && url.hostname === 'localhost') {
    url.protocol = 'http:';
    url.port = '8000';
    url.hostname = '127.0.0.1';
  }
  iframe.src = url.toString();
  iframe.style.width = '100%';
  iframe.style.height = '400px';
  iframe.style.border = '2px dashed #999';
  iframe.style.marginTop = '20px';
  iframe.allow = 'identity-credentials-get';
  container.appendChild(iframe);
}

function log(msg) {
  const logDiv = document.getElementById('gisLog');
  const div = document.createElement('div');
  div.textContent = msg;
  logDiv.appendChild(div);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function clearLocalStorage() {
  localStorage.clear();
  sessionStorage.clear();
  log(`Cleared localStorage and sessionStorage`);
}
