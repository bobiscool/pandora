import {IEndPoint, IIndicator} from '../domain';
import {MetricsMessengerServer} from '../util/MessengerUtil';
import {IndicatorProxy} from '../indicator/IndicatorProxy';
import {IndicatorResult} from '../indicator/IndicatorResult';

const assert = require('assert');
const debug = require('debug')('pandora:metrics:EndPoint');

export class EndPoint implements IEndPoint {

  protected config = {
    enabled: true,
    initConfig: {},
  };

  group: string;

  private messengerServer: MetricsMessengerServer = new MetricsMessengerServer(this.group);

  indicators: Array<IIndicator> = [];

  logger = console;

  /**
   * 激活名下所有指标
   * @param appName
   * @param args
   */
  invoke(appName?: string, args?: any) {

    debug(`Invoke: EndPoint(${this.group}) start query appName = ${appName}, args = ${args}, clientNum = ${this.indicators.length}`);

    // query Indicator
    let indicators: IIndicator[] = this.indicators.filter((indicator: IndicatorProxy) => {
      if (!appName) return true;
      return indicator.match(appName);
    });

    if (indicators) {
      let querys = [];
      for (let proxy of indicators) {
        querys.push(proxy.invoke(args));
      }

      return Promise.all(querys).then((results) => {
        return this.processQueryResults(results, appName, args);
      }).catch((err) => {
        this.logger.error(err);
        throw err;
      });
    }
  }

  initialize() {
    assert(this.group, 'EndPoint name property is required');
    debug(`Discover: EndPoint(${this.group}) start listen and wait Indicators`);
    this.messengerServer.discovery(this.registerIndicator.bind(this));
  }

  processQueryResults(results: Array<IndicatorResult>, appName?: string, args?: any): any {
    debug('Return: get callback from Indicators');
    let allResults = {};

    // loop indicators and get results
    for (let result of results) {
      if (result.isSuccess()) {
        let currentAppResults = allResults[result.getAppName()];
        if (!currentAppResults) {
          currentAppResults = allResults[result.getAppName()] = [];
        }
        allResults[result.getAppName()] = currentAppResults.concat(result.getResults());
      } else {
        this.logger.error(`Query group(${result.getIndicatorGroup()}) IPC results error, message = ${result.getErrorMessage()}`);
      }
    }

    return appName ? allResults[appName] : allResults;
  }

  /**
   * 登记指标
   * @param data
   * @param reply
   * @param client
   */
  protected registerIndicator(data, reply, client) {
    if (this.group !== data.group) {
      // 不匹配则忽略
      return;
    }

    if (data.type === 'singleton') {
      // 单例下，每个应用只允许一个实例存在
      let indicators = this.indicators.filter((indicator: IndicatorProxy) => {
        return indicator.match(data.appName, data.indicatorName);
      });

      if (indicators.length) {
        debug('indicator type singleton=' + data.appName, data.indicatorName);
        return;
      }
    }

    // 把配置回写给所有 indicator
    reply(this.config['initConfig']);

    debug(`Client: register name = ${data.indicatorName} client = ${client._CLIENT_ID}`);
    let indicatorProxy = new IndicatorProxy(client);
    // 构建指标
    indicatorProxy.buildIndicator(data);
    // 连接断开后需要清理
    indicatorProxy.bindRemove(this.removeClient.bind(this));
    this.indicators.push(indicatorProxy);
  }

  protected removeClient(indicatorProxy) {
    this.indicators = this.indicators.filter((indicator) => {
      return indicatorProxy !== indicator;
    });
  }

  setConfig(config) {
    this.config = Object.assign(this.config, config);
  }

  setLogger(logger) {
    this.logger = logger;
  }

  destory(callback?) {
    // clean all indicator
    for (let indicator of this.indicators) {
      indicator.destory();
    }
    this.messengerServer.close(callback);
  }

}
