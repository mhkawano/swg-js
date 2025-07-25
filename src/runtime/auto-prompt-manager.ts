/**
 * Copyright 2021 The Subscribe with Google Authors. All Rights Reserved.
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

import {AnalyticsEvent, EventOriginator} from '../proto/api_messages';
import {Article, EntitlementsManager} from './entitlements-manager';
import {ArticleExperimentFlags} from './experiment-flags';
import {
  AudienceActionFlow,
  AudienceActionIframeFlow,
  AudienceActionType,
  isAudienceActionType,
} from './audience-action-flow';
import {AudienceActionLocalFlow} from './audience-action-local-flow';
import {AutoPromptType, ContentType} from '../api/basic-subscriptions';
import {ClientConfig} from '../model/client-config';
import {ClientConfigManager} from './client-config-manager';
import {ClientEvent} from '../api/client-event-manager-api';
import {ClientEventManager} from './client-event-manager';
import {
  Closability,
  InterventionFunnel,
  InterventionOrchestration,
  RepeatabilityType,
} from '../api/action-orchestration';
import {ConfiguredRuntime} from './runtime';
import {Deps} from './deps';
import {Doc} from '../model/doc';
import {Duration, FrequencyCapConfig} from '../model/auto-prompt-config';
import {Entitlements} from '../api/entitlements';
import {GoogleAnalyticsEventListener} from './google-analytics-event-listener';
import {Intervention, PromptPreference} from './intervention';
import {InterventionType} from '../api/intervention-type';
import {MiniPromptApi} from './mini-prompt-api';
import {OffersRequest} from '../api/subscriptions';
import {PageConfig} from '../model/page-config';
import {Storage, pruneTimestamps} from './storage';
import {StorageKeys} from '../utils/constants';
import {assert} from '../utils/log';

const SECOND_IN_MILLIS = 1000;

const monetizationImpressionEvents = [
  AnalyticsEvent.IMPRESSION_SWG_CONTRIBUTION_MINI_PROMPT,
  AnalyticsEvent.IMPRESSION_SWG_SUBSCRIPTION_MINI_PROMPT,
  AnalyticsEvent.IMPRESSION_OFFERS,
  AnalyticsEvent.IMPRESSION_CONTRIBUTION_OFFERS,
];

const DISMISSAL_EVENTS_TO_ACTION_MAP = new Map([
  [
    AnalyticsEvent.ACTION_SWG_CONTRIBUTION_MINI_PROMPT_CLOSE,
    InterventionType.TYPE_CONTRIBUTION,
  ],
  [
    AnalyticsEvent.ACTION_CONTRIBUTION_OFFERS_CLOSED,
    InterventionType.TYPE_CONTRIBUTION,
  ],
  [
    AnalyticsEvent.ACTION_NEWSLETTER_OPT_IN_CLOSE,
    InterventionType.TYPE_NEWSLETTER_SIGNUP,
  ],
  [
    AnalyticsEvent.ACTION_BYOP_NEWSLETTER_OPT_IN_CLOSE,
    InterventionType.TYPE_NEWSLETTER_SIGNUP,
  ],
  [
    AnalyticsEvent.ACTION_REGWALL_OPT_IN_CLOSE,
    InterventionType.TYPE_REGISTRATION_WALL,
  ],
  [AnalyticsEvent.ACTION_SURVEY_CLOSED, InterventionType.TYPE_REWARDED_SURVEY],
  [AnalyticsEvent.ACTION_REWARDED_AD_CLOSE, InterventionType.TYPE_REWARDED_AD],
  [AnalyticsEvent.ACTION_BYO_CTA_CLOSE, InterventionType.TYPE_BYO_CTA],
  [
    AnalyticsEvent.ACTION_SWG_SUBSCRIPTION_MINI_PROMPT_CLOSE,
    InterventionType.TYPE_SUBSCRIPTION,
  ],
  [
    AnalyticsEvent.ACTION_SUBSCRIPTION_OFFERS_CLOSED,
    InterventionType.TYPE_SUBSCRIPTION,
  ],
]);

const COMPLETION_EVENTS_TO_ACTION_MAP = new Map([
  [
    AnalyticsEvent.EVENT_CONTRIBUTION_PAYMENT_COMPLETE,
    InterventionType.TYPE_CONTRIBUTION,
  ],
  [
    AnalyticsEvent.ACTION_NEWSLETTER_OPT_IN_BUTTON_CLICK,
    InterventionType.TYPE_NEWSLETTER_SIGNUP,
  ],
  [
    AnalyticsEvent.ACTION_BYOP_NEWSLETTER_OPT_IN_SUBMIT,
    InterventionType.TYPE_NEWSLETTER_SIGNUP,
  ],
  [
    AnalyticsEvent.ACTION_REGWALL_OPT_IN_BUTTON_CLICK,
    InterventionType.TYPE_REGISTRATION_WALL,
  ],
  [
    AnalyticsEvent.ACTION_SURVEY_SUBMIT_CLICK,
    InterventionType.TYPE_REWARDED_SURVEY,
  ],
  [AnalyticsEvent.ACTION_REWARDED_AD_VIEW, InterventionType.TYPE_REWARDED_AD],
  [AnalyticsEvent.ACTION_BYO_CTA_BUTTON_CLICK, InterventionType.TYPE_BYO_CTA],
  [
    AnalyticsEvent.EVENT_SUBSCRIPTION_PAYMENT_COMPLETE,
    InterventionType.TYPE_SUBSCRIPTION,
  ],
]);

const IMPRESSION_EVENTS_TO_ACTION_MAP = new Map([
  [
    AnalyticsEvent.IMPRESSION_SWG_CONTRIBUTION_MINI_PROMPT,
    InterventionType.TYPE_CONTRIBUTION,
  ],
  [
    AnalyticsEvent.IMPRESSION_CONTRIBUTION_OFFERS,
    InterventionType.TYPE_CONTRIBUTION,
  ],
  [
    AnalyticsEvent.IMPRESSION_NEWSLETTER_OPT_IN,
    InterventionType.TYPE_NEWSLETTER_SIGNUP,
  ],
  [
    AnalyticsEvent.IMPRESSION_BYOP_NEWSLETTER_OPT_IN,
    InterventionType.TYPE_NEWSLETTER_SIGNUP,
  ],
  [
    AnalyticsEvent.IMPRESSION_REGWALL_OPT_IN,
    InterventionType.TYPE_REGISTRATION_WALL,
  ],
  [AnalyticsEvent.IMPRESSION_SURVEY, InterventionType.TYPE_REWARDED_SURVEY],
  [AnalyticsEvent.IMPRESSION_REWARDED_AD, InterventionType.TYPE_REWARDED_AD],
  [AnalyticsEvent.IMPRESSION_BYO_CTA, InterventionType.TYPE_BYO_CTA],
  [
    AnalyticsEvent.IMPRESSION_SWG_SUBSCRIPTION_MINI_PROMPT,
    InterventionType.TYPE_SUBSCRIPTION,
  ],
  [AnalyticsEvent.IMPRESSION_OFFERS, InterventionType.TYPE_SUBSCRIPTION],
]);

const GENERIC_COMPLETION_EVENTS = [AnalyticsEvent.EVENT_PAYMENT_FAILED];

const ACTON_CTA_BUTTON_CLICK = [
  AnalyticsEvent.ACTION_SWG_BUTTON_SHOW_OFFERS_CLICK,
  AnalyticsEvent.ACTION_SWG_BUTTON_SHOW_CONTRIBUTIONS_CLICK,
];

export interface ShowAutoPromptParams {
  autoPromptType?: AutoPromptType;
  alwaysShow?: boolean;
  isClosable?: boolean;
  contentType: ContentType;
}

interface ActionsTimestamps {
  [key: string]: ActionTimestamps;
}

interface ActionTimestamps {
  impressions: number[];
  dismissals: number[];
  completions: number[];
}

/**
 * Manages the display of subscription/contribution prompts automatically
 * displayed to the user.
 */
export class AutoPromptManager {
  private isInDevMode_?: boolean;
  private hasStoredMiniPromptImpression_ = false;
  private promptIsFromCtaButton_ = false;
  private lastAudienceActionFlow_: AudienceActionFlow | null = null;
  private configId_?: string;
  private isClosable_?: boolean;
  private isMonetizationClosable_?: boolean;
  private autoPromptType_?: AutoPromptType;
  private contentType_?: ContentType;
  private shouldRenderOnsitePreview_: boolean = false;
  private standardRewardedAdExperiment = false;
  private multiInstanceCtaExperiment: boolean = false;

  private readonly doc_: Doc;
  private readonly pageConfig_: PageConfig;
  private readonly entitlementsManager_: EntitlementsManager;
  private readonly clientConfigManager_: ClientConfigManager;
  private readonly storage_: Storage;
  private readonly miniPromptAPI_: MiniPromptApi;
  private readonly eventManager_: ClientEventManager;

  constructor(
    private readonly deps_: Deps,
    private readonly configuredRuntime_: ConfiguredRuntime
  ) {
    this.doc_ = deps_.doc();

    this.pageConfig_ = deps_.pageConfig();

    this.entitlementsManager_ = deps_.entitlementsManager();

    this.clientConfigManager_ = deps_.clientConfigManager();
    assert(
      this.clientConfigManager_,
      'AutoPromptManager requires an instance of ClientConfigManager.'
    );

    this.storage_ = deps_.storage();

    deps_
      .eventManager()
      .registerEventListener(this.handleClientEvent_.bind(this));

    this.miniPromptAPI_ = new MiniPromptApi(deps_);
    this.miniPromptAPI_.init();

    this.eventManager_ = deps_.eventManager();
  }

  /**
   * Triggers the display of the auto prompt, if preconditions are met.
   * Preconditions are as follows:
   *   - alwaysShow == true, used for demo purposes, OR
   *   - There is no active entitlement found AND
   *   - The user had not reached the maximum impressions allowed, as specified
   *     by the publisher
   * A prompt may not be displayed if the appropriate criteria are not met.
   */
  async showAutoPrompt(params: ShowAutoPromptParams): Promise<void> {
    if (params.autoPromptType === AutoPromptType.NONE) {
      return;
    }

    this.contentType_ = params.contentType;

    // Manual override of display rules, mainly for demo purposes. Requires
    // contribution or subscription to be set as autoPromptType in snippet.
    if (params.alwaysShow) {
      this.isInDevMode_ = true;
      this.autoPromptType_ = this.getPromptTypeToDisplay_(
        params.autoPromptType
      );
      this.isClosable_ = this.contentType_ != ContentType.CLOSED;
      this.isMonetizationClosable_ = this.isClosable_;
      const promptFn = this.getMonetizationPromptFn_();
      promptFn();
      return;
    }

    // Fetch entitlements and the client config from the server, so that we have
    // the information we need to determine whether and which prompt should be
    // displayed.
    const [clientConfig, entitlements, article] = await Promise.all([
      this.clientConfigManager_.getClientConfig(),
      this.entitlementsManager_.getEntitlements(),
      this.entitlementsManager_.getArticle(),
    ]);

    this.setArticleExperimentFlags_(article);

    this.shouldRenderOnsitePreview_ = !!article?.previewEnabled;

    if (this.shouldRenderOnsitePreview_) {
      await this.showPreviewAutoPrompt_(article!, params);
    } else {
      await this.showAutoPrompt_(clientConfig, entitlements, article, params);
    }
  }

  /**
   * Sets experiment flags from article experiment config.
   */
  private setArticleExperimentFlags_(article: Article | null): void {
    if (!article) {
      return;
    }
    // Set experiment flags here.
    this.standardRewardedAdExperiment = this.isArticleExperimentEnabled_(
      article,
      ArticleExperimentFlags.STANDARD_REWARDED_AD_EXPERIMENT
    );
    this.multiInstanceCtaExperiment = this.isArticleExperimentEnabled_(
      article,
      ArticleExperimentFlags.MULTI_INSTANCE_CTA_EXPERIMENT
    );
  }

  /**
   * Displays the appropriate auto prompt for onsite preview.
   */
  private async showPreviewAutoPrompt_(
    article: Article,
    params: ShowAutoPromptParams
  ): Promise<void> {
    const actions = article.audienceActions?.actions;
    if (!actions || actions.length === 0) {
      return;
    }
    // Article response is honored over code snippet in case of conflict, such
    // as when publisher changes revenue model but does not update snippet.
    this.autoPromptType_ = this.getAutoPromptType_(
      article.audienceActions?.actions,
      params.autoPromptType
    )!;

    // For FCA - default to the contentType.
    // TODO(b/364344782): Determine closability for Phase 2+.
    this.isClosable_ = this.contentType_ != ContentType.CLOSED;
    this.isMonetizationClosable_ = this.isClosable_;

    const previewAction = actions[0];

    const promptFn = this.getAutoPromptFunction_(previewAction);

    // Directly invoke preview prompt at first, we can add delay later on if needed.
    promptFn();
    return;
  }

  /**
   * Displays the appropriate auto prompt, depending on the fetched prompt
   * configuration, entitlement state, and options specified in params.
   */
  private async showAutoPrompt_(
    clientConfig: ClientConfig,
    entitlements: Entitlements,
    article: Article | null,
    params: ShowAutoPromptParams
  ): Promise<void> {
    this.isInDevMode_ = false;
    if (!article) {
      return;
    }

    if (!clientConfig.uiPredicates?.canDisplayAutoPrompt) {
      return;
    }

    const hasValidEntitlements = entitlements.enablesThis();
    if (hasValidEntitlements) {
      return;
    }

    // Article response is honored over code snippet in case of conflict, such
    // as when publisher changes revenue model but does not update snippet.
    this.autoPromptType_ = this.getAutoPromptType_(
      article.audienceActions?.actions,
      params.autoPromptType
    )!;

    // TODO(justinchou): refactor so that getting potentialAction is atomic with no
    // side effects like setting dismissibility.
    let potentialAction;
    if (!!article.actionOrchestration) {
      const nextOrchestration = await this.getInterventionOrchestration_(
        clientConfig,
        article
      );
      if (!!nextOrchestration) {
        this.isClosable_ = this.isOrchestrationClosable(nextOrchestration);
        potentialAction = article.audienceActions?.actions?.find(
          (action) => action.configurationId === nextOrchestration.configId
        );
      }
      if (this.isContribution_() || this.isSubscription_()) {
        this.isMonetizationClosable_ = this.isClosable_;
        const monetizationIntervention =
          article.actionOrchestration.interventionFunnel?.interventions?.find(
            (intervention) =>
              intervention.type === InterventionType.TYPE_SUBSCRIPTION ||
              intervention.type === InterventionType.TYPE_CONTRIBUTION
          );
        if (monetizationIntervention) {
          this.isMonetizationClosable_ = this.isOrchestrationClosable(
            monetizationIntervention
          );
        }
      }
    } else {
      // Unexpected state where actionOrchestration is not defined.
      // For closed content, show subsription if it is eligible.
      if (this.contentType_ === ContentType.CLOSED) {
        const subscriptionAction = article.audienceActions?.actions?.find(
          (action) => action.type === InterventionType.TYPE_SUBSCRIPTION
        );
        if (subscriptionAction) {
          this.isClosable_ = false;
          this.isMonetizationClosable_ = false;
          potentialAction = {
            type: subscriptionAction.type,
            configurationId: subscriptionAction.configurationId,
          };
        }
      }
    }

    const promptFn = potentialAction
      ? this.getAutoPromptFunction_(potentialAction)
      : undefined;

    if (!promptFn) {
      return;
    }

    this.promptIsFromCtaButton_ = false;
    this.configId_ = potentialAction?.configurationId;
    // Add display delay to dismissible prompts.
    const displayDelayMs = this.isClosable_
      ? (clientConfig?.autoPromptConfig?.clientDisplayTrigger
          ?.displayDelaySeconds || 0) * SECOND_IN_MILLIS
      : 0;

    if (displayDelayMs > 0) {
      this.deps_.win().setTimeout(promptFn, displayDelayMs);
    } else {
      promptFn();
    }
    return;
  }

  private isOrchestrationClosable(orchestration: InterventionOrchestration) {
    switch (orchestration?.closability) {
      case Closability.BLOCKING:
        return false;
      case Closability.DISMISSIBLE:
        return true;
      default:
        return this.contentType_ != ContentType.CLOSED;
    }
  }

  private isSubscription_(): boolean {
    return (
      this.autoPromptType_ === AutoPromptType.SUBSCRIPTION ||
      this.autoPromptType_ === AutoPromptType.SUBSCRIPTION_LARGE
    );
  }

  private isContribution_(): boolean {
    return (
      this.autoPromptType_ === AutoPromptType.CONTRIBUTION ||
      this.autoPromptType_ === AutoPromptType.CONTRIBUTION_LARGE
    );
  }

  private isMonetizationAction_(actionType: InterventionType): boolean {
    return (
      actionType === InterventionType.TYPE_SUBSCRIPTION ||
      actionType === InterventionType.TYPE_CONTRIBUTION
    );
  }

  /**
   * Determines what Monetization prompt type should be shown. Determined by
   * the first AutoPromptType passed in from Article Actions. Only enables the
   * mini prompt if the autoPromptType mini prompt snippet is present.
   */
  private getAutoPromptType_(
    actions: Intervention[] = [],
    autoPromptType?: AutoPromptType
  ): AutoPromptType | undefined {
    const potentialAction = actions.find(
      (action) =>
        action.type === InterventionType.TYPE_CONTRIBUTION ||
        action.type === InterventionType.TYPE_SUBSCRIPTION
    );

    // No article actions match contribution or subscription.
    if (!potentialAction) {
      return undefined;
    }

    const snippetAction =
      potentialAction.type === InterventionType.TYPE_CONTRIBUTION
        ? // Allow autoPromptType to enable miniprompt.
          autoPromptType === AutoPromptType.CONTRIBUTION
          ? AutoPromptType.CONTRIBUTION
          : AutoPromptType.CONTRIBUTION_LARGE
        : autoPromptType === AutoPromptType.SUBSCRIPTION
        ? AutoPromptType.SUBSCRIPTION
        : AutoPromptType.SUBSCRIPTION_LARGE;

    return this.getPromptTypeToDisplay_(snippetAction);
  }

  private async getInterventionOrchestration_(
    clientConfig: ClientConfig,
    article: Article
  ): Promise<InterventionOrchestration | void> {
    const eligibleActions = article.audienceActions?.actions;
    let interventionOrchestration =
      article.actionOrchestration?.interventionFunnel?.interventions;
    if (!eligibleActions?.length || !interventionOrchestration?.length) {
      return;
    }

    // Complete client-side eligibility checks for actions.
    const actionsTimestamps = await this.getTimestamps();
    const eligibleActionIds = new Set(
      eligibleActions
        .filter((action) =>
          this.checkActionEligibility_(action, actionsTimestamps!)
        )
        .map((action) => action.configurationId)
    );
    if (eligibleActionIds.size === 0) {
      return;
    }

    // Filter the funnel of interventions by eligibility.
    const numberOfCompletionsMap = new Map(
      article
        .audienceActions!.actions!.filter(
          (action) => !!action.numberOfCompletions
        )
        .map((action) => [action.configurationId!, action.numberOfCompletions!])
    );
    interventionOrchestration = interventionOrchestration.filter(
      (intervention) =>
        this.checkOrchestrationEligibility_(
          intervention,
          eligibleActionIds,
          numberOfCompletionsMap,
          clientConfig
        )
    );
    if (interventionOrchestration.length === 0) {
      return;
    }

    if (this.contentType_ === ContentType.CLOSED) {
      return interventionOrchestration[0];
    }

    // Check Default FrequencyCapConfig is valid.
    if (
      !this.isValidFrequencyCap_(
        clientConfig.autoPromptConfig?.frequencyCapConfig
      )
    ) {
      this.eventManager_.logSwgEvent(
        AnalyticsEvent.EVENT_FREQUENCY_CAP_CONFIG_NOT_FOUND_ERROR
      );
      return interventionOrchestration[0];
    }

    // Only other supported ContentType is OPEN.
    let nextOrchestration: InterventionOrchestration | undefined;

    // b/325512849: Evaluate prompt frequency cap before global frequency cap.
    // This disambiguates the scenarios where a reader meets the cap when the
    // reader is only eligible for 1 prompt vs. when the publisher only has 1
    // prompt configured.
    for (const orchestration of interventionOrchestration) {
      const promptFrequencyCapDuration = this.getPromptFrequencyCapDuration_(
        clientConfig.autoPromptConfig?.frequencyCapConfig!,
        orchestration
      );
      if (this.isValidFrequencyCapDuration_(promptFrequencyCapDuration)) {
        const timestamps = this.getTimestampsForPromptFrequency_(
          actionsTimestamps,
          orchestration
        );
        if (this.isFrequencyCapped_(promptFrequencyCapDuration!, timestamps)) {
          this.eventManager_.logSwgEvent(
            AnalyticsEvent.EVENT_PROMPT_FREQUENCY_CAP_MET
          );
          continue;
        }
      }
      nextOrchestration = orchestration;
      break;
    }

    if (!nextOrchestration) {
      return;
    }

    const globalFrequencyCapDuration = this.getGlobalFrequencyCapDuration_(
      clientConfig.autoPromptConfig?.frequencyCapConfig!,
      article.actionOrchestration?.interventionFunnel!
    );
    if (this.isValidFrequencyCapDuration_(globalFrequencyCapDuration)) {
      const globalTimestamps = Array.prototype.concat.apply(
        [],
        Object.entries(actionsTimestamps!)
          .filter(([key, _]) =>
            // During FCA Phase 1, include all events
            this.multiInstanceCtaExperiment
              ? true
              : // Before FCA Phase 1 rampup, ignore events keyed by configId
                Object.values<string>(InterventionType).includes(key)
          )
          // Completed repeatable actions count towards global frequency
          .map(([key, timestamps]) =>
            // During FCA Phase 1, only get completions of matching config ID
            this.multiInstanceCtaExperiment &&
            key === nextOrchestration!.configId
              ? timestamps.completions
              : // For backwards compatability, continue to get completions of matching action type
              key === nextOrchestration!.type
              ? timestamps.completions
              : timestamps.impressions
          )
      );
      if (
        this.isFrequencyCapped_(globalFrequencyCapDuration!, globalTimestamps)
      ) {
        this.eventManager_.logSwgEvent(
          AnalyticsEvent.EVENT_GLOBAL_FREQUENCY_CAP_MET
        );
        return;
      }
    }
    return nextOrchestration;
  }

  /**
   * Returns a function to show the appropriate monetization prompt,
   * or undefined if the type of prompt cannot be determined.
   */
  private getLargeMonetizationPromptFn_(
    shouldAnimateFade: boolean = true
  ): (() => void) | undefined {
    const options: OffersRequest = {
      isClosable: !!this.isMonetizationClosable_,
      shouldAnimateFade,
    };
    if (this.isSubscription_()) {
      return () => {
        this.configuredRuntime_.showOffers(options);
      };
    } else if (this.isContribution_()) {
      return () => {
        this.configuredRuntime_.showContributionOptions(options);
      };
    }
    return undefined;
  }

  private getAudienceActionPromptFn_(
    action: AudienceActionType,
    configurationId: string,
    preference?: PromptPreference
  ): () => void {
    return () => {
      const audienceActionFlow: AudienceActionFlow =
        action === InterventionType.TYPE_REWARDED_AD &&
        !this.standardRewardedAdExperiment
          ? new AudienceActionLocalFlow(this.deps_, {
              action,
              configurationId,
              autoPromptType: this.autoPromptType_,
              isClosable: this.isClosable_,
              monetizationFunction: this.getLargeMonetizationPromptFn_(
                /* shouldAnimateFade */ false
              ),
              calledManually: false,
              shouldRenderPreview: !!this.shouldRenderOnsitePreview_,
            })
          : action === InterventionType.TYPE_NEWSLETTER_SIGNUP &&
            preference === PromptPreference.PREFERENCE_PUBLISHER_PROVIDED_PROMPT
          ? new AudienceActionLocalFlow(this.deps_, {
              action,
              configurationId,
              autoPromptType: this.autoPromptType_,
              isClosable: this.isClosable_,
              calledManually: false,
              shouldRenderPreview: !!this.shouldRenderOnsitePreview_,
            })
          : new AudienceActionIframeFlow(this.deps_, {
              action,
              configurationId,
              preference,
              autoPromptType: this.autoPromptType_,
              isClosable: this.isClosable_,
              calledManually: false,
              shouldRenderPreview: !!this.shouldRenderOnsitePreview_,
              onAlternateAction: this.getLargeMonetizationPromptFn_(
                /* shouldAnimateFade */ false
              ),
            });
      this.setLastAudienceActionFlow(audienceActionFlow);
      audienceActionFlow.start();
    };
  }

  setLastAudienceActionFlow(flow: AudienceActionFlow): void {
    this.lastAudienceActionFlow_ = flow;
  }

  getLastAudienceActionFlow(): AudienceActionFlow | null {
    return this.lastAudienceActionFlow_;
  }

  /**
   * Shows the prompt based on the type specified.
   */
  private getMonetizationPromptFn_(): () => void {
    const displayLargePromptFn = this.getLargeMonetizationPromptFn_();
    return () => {
      if (
        this.autoPromptType_ === AutoPromptType.SUBSCRIPTION ||
        this.autoPromptType_ === AutoPromptType.CONTRIBUTION
      ) {
        this.miniPromptAPI_.create({
          autoPromptType: this.autoPromptType_,
          clickCallback: displayLargePromptFn,
        });
      } else if (
        (this.autoPromptType_ === AutoPromptType.SUBSCRIPTION_LARGE ||
          this.autoPromptType_ === AutoPromptType.CONTRIBUTION_LARGE) &&
        displayLargePromptFn
      ) {
        displayLargePromptFn();
      }
    };
  }

  /**
   * Returns which type of prompt to display based on the type specified and
   * the viewport width. If the desktop is wider than 480px, then the large
   * prompt type will be substituted for the miniprompt. The original
   * promptType will be returned as-is in all other cases.
   */
  private getPromptTypeToDisplay_(
    promptType?: AutoPromptType
  ): AutoPromptType | undefined {
    const isWideDesktop = this.getInnerWidth_() > 480;
    if (isWideDesktop) {
      if (promptType === AutoPromptType.SUBSCRIPTION) {
        this.logDisableMinipromptEvent_(promptType);
        return AutoPromptType.SUBSCRIPTION_LARGE;
      }
      if (promptType === AutoPromptType.CONTRIBUTION) {
        this.logDisableMinipromptEvent_(promptType);
        return AutoPromptType.CONTRIBUTION_LARGE;
      }
    }

    return promptType;
  }

  /**
   * Logs the disable miniprompt event.
   */
  private logDisableMinipromptEvent_(
    overriddenPromptType?: AutoPromptType
  ): void {
    this.eventManager_.logEvent({
      eventType: AnalyticsEvent.EVENT_DISABLE_MINIPROMPT_DESKTOP,
      eventOriginator: EventOriginator.SWG_CLIENT,
      isFromUserAction: false,
      additionalParameters: {
        publicationid: this.pageConfig_.getPublicationId(),
        promptType: overriddenPromptType,
      },
    });
  }

  /**
   * Listens for relevant prompt impression events, dismissal events, and completed
   * action events, and logs them to local storage for use in determining whether
   * to display the prompt in the future.
   */
  private async handleClientEvent_(event: ClientEvent): Promise<void> {
    if (!event.eventType) {
      return;
    }

    // ** Frequency Capping Events **
    if (ACTON_CTA_BUTTON_CLICK.find((e) => e === event.eventType)) {
      this.promptIsFromCtaButton_ = true;
    }
    await this.handleFrequencyCappingLocalStorage_(event.eventType);
  }

  /**
   * Executes required local storage gets and sets for Frequency Capping flow.
   * Events of prompts for paygated content do not count toward frequency cap.
   * Maintains hasStoredMiniPromptImpression_ so as not to store multiple
   * impression timestamps for mini/normal contribution prompt.
   */
  private async handleFrequencyCappingLocalStorage_(
    analyticsEvent: AnalyticsEvent
  ): Promise<void> {
    // For FCA, do not log frequency capping event for closed contentType. Blocking
    // interventions on Open content will still log impression & completion timestamps
    // (but not dismissal).
    if (this.contentType_ === ContentType.CLOSED) {
      return;
    }

    if (
      !(
        IMPRESSION_EVENTS_TO_ACTION_MAP.has(analyticsEvent) ||
        DISMISSAL_EVENTS_TO_ACTION_MAP.has(analyticsEvent) ||
        COMPLETION_EVENTS_TO_ACTION_MAP.has(analyticsEvent) ||
        GENERIC_COMPLETION_EVENTS.find((e) => e === analyticsEvent)
      )
    ) {
      return;
    }

    if (
      !this.promptIsFromCtaButton_ &&
      monetizationImpressionEvents.includes(analyticsEvent)
    ) {
      if (this.hasStoredMiniPromptImpression_) {
        return;
      }
      this.hasStoredMiniPromptImpression_ = true;
    }

    this.storeEvent(analyticsEvent);
  }

  /**
   * Fetches frequency capping timestamps from local storage for prompts.
   * Timestamps are not necessarily sorted.
   */
  async getTimestamps(): Promise<ActionsTimestamps> {
    const stringified = await this.storage_.get(
      StorageKeys.TIMESTAMPS,
      /* useLocalStorage */ true
    );
    if (!stringified) {
      return {};
    }

    const timestamps: ActionsTimestamps = JSON.parse(stringified);
    if (!this.isValidActionsTimestamps_(timestamps)) {
      this.eventManager_.logSwgEvent(
        AnalyticsEvent.EVENT_LOCAL_STORAGE_TIMESTAMPS_PARSING_ERROR
      );
      return {};
    }
    return Object.entries(timestamps).reduce(
      (acc: ActionsTimestamps, [key, value]: [string, ActionTimestamps]) => {
        return {
          ...acc,
          [key]: {
            impressions: pruneTimestamps(value.impressions),
            dismissals: pruneTimestamps(value.dismissals),
            completions: pruneTimestamps(value.completions),
          },
        };
      },
      {}
    );
  }

  private getTimestampsForPromptFrequency_(
    timestamps: ActionsTimestamps,
    orchestration: InterventionOrchestration
  ) {
    const actionTimestamps = this.multiInstanceCtaExperiment
      ? timestamps[orchestration.configId]
      : timestamps[orchestration.type];
    return orchestration.closability === Closability.BLOCKING
      ? actionTimestamps?.completions || []
      : [
          ...(actionTimestamps?.dismissals || []),
          ...(actionTimestamps?.completions || []),
        ];
  }

  isValidActionsTimestamps_(timestamps: ActionsTimestamps) {
    return (
      timestamps instanceof Object &&
      !(timestamps instanceof Array) &&
      Object.values(
        Object.values(timestamps).map(
          (t) =>
            Object.keys(t).length === 3 &&
            t.impressions.every((n) => !isNaN(n)) &&
            t.dismissals.every((n) => !isNaN(n)) &&
            t.completions.every((n) => !isNaN(n))
        )
      ).every(Boolean)
    );
  }

  async setTimestamps(timestamps: ActionsTimestamps) {
    const json = JSON.stringify(timestamps);
    this.storage_.set(StorageKeys.TIMESTAMPS, json, /* useLocalStorage */ true);
  }

  async storeImpression(action: string): Promise<void> {
    const timestamps = await this.getTimestamps();
    const actionTimestamps = timestamps[action] || {
      impressions: [],
      dismissals: [],
      completions: [],
    };
    actionTimestamps.impressions.push(Date.now());
    timestamps[action] = actionTimestamps;
    // FCA Phase 1: Dual write frequency capping events keyed by configid
    // TODO(justinchou): Add error handling and logging for absent configId
    if (!this.isInDemoMode_() && this.configId_) {
      const configTimestamps = timestamps[this.configId_] || {
        impressions: [],
        dismissals: [],
        completions: [],
      };
      configTimestamps.impressions.push(Date.now());
      timestamps[this.configId_] = configTimestamps;
    }
    this.setTimestamps(timestamps);
  }

  async storeDismissal(action: string): Promise<void> {
    const timestamps = await this.getTimestamps();
    const actionTimestamps = timestamps[action] || {
      impressions: [],
      dismissals: [],
      completions: [],
    };
    actionTimestamps.dismissals.push(Date.now());
    timestamps[action] = actionTimestamps;
    // FCA Phase 1: Dual write frequency capping events keyed by configid
    // TODO(justinchou): Add error handling and logging for absent configId
    if (!this.isInDemoMode_() && this.configId_) {
      const configTimestamps = timestamps[this.configId_] || {
        impressions: [],
        dismissals: [],
        completions: [],
      };
      configTimestamps.dismissals.push(Date.now());
      timestamps[this.configId_] = configTimestamps;
    }
    this.setTimestamps(timestamps);
  }

  async storeCompletion(action: string): Promise<void> {
    const timestamps = await this.getTimestamps();
    const actionTimestamps = timestamps[action] || {
      impressions: [],
      dismissals: [],
      completions: [],
    };
    actionTimestamps.completions.push(Date.now());
    timestamps[action] = actionTimestamps;
    // FCA Phase 1: Dual write frequency capping events keyed by configid
    // TODO(justinchou): Add error handling and logging for absent configId
    if (!this.isInDemoMode_() && this.configId_) {
      const configTimestamps = timestamps[this.configId_] || {
        impressions: [],
        dismissals: [],
        completions: [],
      };
      configTimestamps.completions.push(Date.now());
      timestamps[this.configId_] = configTimestamps;
    }
    this.setTimestamps(timestamps);
  }

  async storeEvent(event: AnalyticsEvent): Promise<void> {
    let action;
    if (IMPRESSION_EVENTS_TO_ACTION_MAP.has(event)) {
      // b/333536312: Only store impression if prompt was not triggered via cta
      // click.
      if (!this.promptIsFromCtaButton_) {
        action = IMPRESSION_EVENTS_TO_ACTION_MAP.get(event);
        this.storeImpression(action!);
      }
    } else if (DISMISSAL_EVENTS_TO_ACTION_MAP.has(event)) {
      action = DISMISSAL_EVENTS_TO_ACTION_MAP.get(event);
      this.storeDismissal(action!);
    } else if (COMPLETION_EVENTS_TO_ACTION_MAP.has(event)) {
      action = COMPLETION_EVENTS_TO_ACTION_MAP.get(event);
      this.storeCompletion(action!);
    } else if (GENERIC_COMPLETION_EVENTS.includes(event)) {
      if (this.isContribution_()) {
        this.storeCompletion(InterventionType.TYPE_CONTRIBUTION);
      }
      if (this.isSubscription_()) {
        this.storeCompletion(InterventionType.TYPE_SUBSCRIPTION);
      }
      // TODO(justinchou@) handle failure modes for event EVENT_PAYMENT_FAILED
    }
  }

  private getInnerWidth_(): number {
    return this.doc_.getWin()./* OK */ innerWidth;
  }

  /**
   * Returns whether the client is executing a demo workflow, not shown to
   * readers. Example: Via Onsite Preview or params.alwaysShow override.
   * For FCA Phase 1+, this will be used to check when to set Frequency Capping
   * event timestamps.
   */
  private isInDemoMode_(): boolean {
    return this.isInDevMode_ || this.shouldRenderOnsitePreview_;
  }

  /**
   * Checks AudienceAction eligbility, used to filter potential actions.
   */
  private checkActionEligibility_(
    action: Intervention,
    timestamps: ActionsTimestamps
  ): boolean {
    if (action.type === InterventionType.TYPE_REWARDED_SURVEY) {
      const isAnalyticsEligible =
        GoogleAnalyticsEventListener.isGaEligible(this.deps_) ||
        GoogleAnalyticsEventListener.isGtagEligible(this.deps_) ||
        GoogleAnalyticsEventListener.isGtmEligible(this.deps_);
      if (!isAnalyticsEligible) {
        return false;
      }
      // Do not show survey if there is a previous completion record.
      // Client side eligibility is required to handle identity transitions
      // after sign-in flow. TODO(b/332759781): update survey completion check
      // to persist even after 2 weeks.
      const completions = this.multiInstanceCtaExperiment
        ? timestamps[action.configurationId!]?.completions
        : timestamps[InterventionType.TYPE_REWARDED_SURVEY]?.completions;
      return !(completions || []).length;
    }
    // NOTE: passing these checks does not mean the APIs are always available.
    if (action.type === InterventionType.TYPE_REWARDED_AD) {
      if (
        action.preference === PromptPreference.PREFERENCE_ADSENSE_REWARDED_AD
      ) {
        const adsbygoogle = this.deps_.win().adsbygoogle;
        if (!adsbygoogle?.loaded) {
          this.eventManager_.logSwgEvent(
            AnalyticsEvent.EVENT_REWARDED_AD_ADSENSE_FILTERED
          );
          return false;
        }
      } else {
        const googletag = this.deps_.win().googletag;
        // Because this happens after the article call, googletag should have had enough time to set up
        if (!googletag?.getVersion()) {
          this.eventManager_.logSwgEvent(
            AnalyticsEvent.EVENT_REWARDED_AD_GPT_FILTERED
          );
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Checks Intervention eligibility, used to filter interventions in a given
   * funnel.
   */
  private checkOrchestrationEligibility_(
    orchestration: InterventionOrchestration,
    eligibleActionIds: Set<string | undefined>,
    numberOfCompletionsMap: Map<string, number>,
    clientConfig: ClientConfig
  ): boolean {
    const {repeatability, closability, configId} = orchestration;
    if (!eligibleActionIds.has(configId)) {
      return false;
    }

    if (repeatability?.type !== RepeatabilityType.INFINITE) {
      const maximumNumberOfCompletions =
        RepeatabilityType.FINITE === repeatability?.type
          ? repeatability.count || 1
          : 1;
      let numberOfCompletions;
      if (!numberOfCompletionsMap.has(configId)) {
        if (RepeatabilityType.FINITE === repeatability?.type) {
          this.eventManager_.logSwgEvent(
            AnalyticsEvent.EVENT_COMPLETION_COUNT_FOR_REPEATABLE_ACTION_MISSING_ERROR
          );
        }
        numberOfCompletions = 0;
      } else {
        numberOfCompletions = numberOfCompletionsMap.get(configId)!;
      }
      if (numberOfCompletions! >= maximumNumberOfCompletions) {
        return false;
      }
    }

    // Prevent readers from seeing dismissible CTAs they can't interact with.
    const readerCannotPurchase =
      !!clientConfig?.uiPredicates?.purchaseUnavailableRegion &&
      this.isMonetizationAction_(orchestration.type);
    const isDismissible =
      this.contentType_ !== ContentType.CLOSED ||
      closability === Closability.DISMISSIBLE;
    if (isDismissible && readerCannotPurchase) {
      return false;
    }

    return true;
  }

  /**
   * Computes if the frequency cap is met from the timestamps of previous
   * provided by using the maximum/most recent timestamp.
   */
  private isFrequencyCapped_(
    frequencyCapDuration: Duration,
    timestamps: number[]
  ): boolean {
    if (timestamps.length === 0) {
      return false;
    }

    const lastImpression = Math.max(...timestamps);
    const durationInMs =
      (frequencyCapDuration.seconds || 0) * SECOND_IN_MILLIS +
      this.nanoToMiliseconds_(frequencyCapDuration.nanos || 0);
    return Date.now() - lastImpression < durationInMs;
  }

  private nanoToMiliseconds_(nanos: number): number {
    return Math.floor(nanos / Math.pow(10, 6));
  }

  private getPromptFrequencyCapDuration_(
    frequencyCapConfig: FrequencyCapConfig,
    interventionOrchestration: InterventionOrchestration
  ): Duration | undefined {
    const duration = interventionOrchestration.promptFrequencyCap?.duration;

    if (!duration) {
      this.eventManager_.logSwgEvent(
        AnalyticsEvent.EVENT_PROMPT_FREQUENCY_CONFIG_NOT_FOUND
      );
      return frequencyCapConfig.anyPromptFrequencyCap?.frequencyCapDuration;
    }
    return duration;
  }

  private getGlobalFrequencyCapDuration_(
    frequencyCapConfig: FrequencyCapConfig,
    interventionFunnel: InterventionFunnel
  ): Duration | undefined {
    const duration = interventionFunnel.globalFrequencyCap?.duration;
    return duration
      ? duration
      : frequencyCapConfig.globalFrequencyCap!.frequencyCapDuration;
  }

  private isValidFrequencyCap_(frequencyCapConfig?: FrequencyCapConfig) {
    return (
      this.isValidFrequencyCapDuration_(
        frequencyCapConfig?.globalFrequencyCap?.frequencyCapDuration
      ) ||
      frequencyCapConfig?.promptFrequencyCaps
        ?.map((frequencyCap) => frequencyCap.frequencyCapDuration)
        .some(this.isValidFrequencyCapDuration_) ||
      this.isValidFrequencyCapDuration_(
        frequencyCapConfig?.anyPromptFrequencyCap?.frequencyCapDuration
      )
    );
  }

  private isValidFrequencyCapDuration_(duration?: Duration) {
    return !!duration?.seconds || !!duration?.nanos;
  }

  private getAutoPromptFunction_(action: Intervention) {
    return isAudienceActionType(action.type) && action.configurationId
      ? this.getAudienceActionPromptFn_(
          action.type,
          action.configurationId,
          action.preference
        )
      : this.getMonetizationPromptFn_();
  }

  /**
   * Checks if provided ExperimentFlag is enabled within article experiment
   * config.
   */
  private isArticleExperimentEnabled_(
    article: Article,
    experimentFlag: string
  ): boolean {
    const articleExpFlags =
      this.entitlementsManager_.parseArticleExperimentConfigFlags(article);
    return articleExpFlags.includes(experimentFlag);
  }
}
