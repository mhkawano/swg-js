/**
 * Copyright 2024 The Subscribe with Google Authors. All Rights Reserved.
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

import {AudienceActionIframeFlow} from '../runtime/audience-action-flow';
import {Deps} from '../runtime/deps';
import {Intervention} from '../runtime/entitlements-manager';
import {SurveyDataTransferRequest} from '../proto/api_messages';

/**
 * Opt-in data passed to the AvailableIntervention.show callback for an opt-in
 * intervention.
 */
export interface OptInResult {
  // Email of the opted-in user, ex. john.johnson@gmail.com
  email: string | null;
  // Display name of the opted-in user, ex. John Johnson
  displayName: string | null;
  // Given name of the opted-in user, ex. John
  givenName: string | null;
  // Family name of the opted-in user, ex. Johnson
  familyName: string | null;
}

/**
 * Result of an intervention passed to the AvailableIntervention.show callback.
 */
export interface InterventionResult {
  // Configuration id of the intervention
  configurationId?: string;
  // Data returned from the intervention
  data: OptInResult | SurveyDataTransferRequest;
}

/**
 * Params passed to the AvailableIntervention.show method.
 */
export interface ShowInterventionParams {
  // Determine whether the view is closable.
  isClosable?: boolean;

  // Callback to get the result data from the intervention. Return a boolean
  // indicating if the data was recorded successfully.
  onResult?: (result: InterventionResult) => Promise<boolean> | boolean;
}

/**
 * Intervention types that can be returned from the article endpoint.
 */
export enum InterventionType {
  TYPE_REGISTRATION_WALL = 'TYPE_REGISTRATION_WALL',
  TYPE_NEWSLETTER_SIGNUP = 'TYPE_NEWSLETTER_SIGNUP',
  TYPE_REWARDED_SURVEY = 'TYPE_REWARDED_SURVEY',
  TYPE_REWARDED_AD = 'TYPE_REWARDED_AD',
  TYPE_CONTRIBUTION = 'TYPE_CONTRIBUTION',
  TYPE_SUBSCRIPTION = 'TYPE_SUBSCRIPTION',
}

export class AvailableIntervention {
  readonly type: InterventionType;

  readonly configurationId?: string;

  private readonly intervention: Intervention;

  constructor(original: Intervention, private readonly deps_: Deps) {
    this.intervention = original;
    this.type = original.type;
    this.configurationId = original.configurationId;
  }

  /**
   * Starts the intervention flow.
   */
  async show(params: ShowInterventionParams): Promise<void> {
    if (
      this.intervention.type === InterventionType.TYPE_NEWSLETTER_SIGNUP ||
      this.intervention.type === InterventionType.TYPE_REGISTRATION_WALL ||
      this.intervention.type === InterventionType.TYPE_REWARDED_SURVEY
    ) {
      const flow = new AudienceActionIframeFlow(this.deps_, {
        isClosable: params.isClosable,
        action: this.intervention.type,
        configurationId: this.intervention.configurationId,
        onResult: params.onResult,
        calledManually: true,
      });
      return flow.start();
    }
    return;
  }
}
