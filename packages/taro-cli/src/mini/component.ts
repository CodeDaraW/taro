import * as fs from 'fs-extra'
import * as path from 'path'

import { Config as IConfig } from '@tarojs/taro'
import * as wxTransformer from '@tarojs/transformer-wx'
import * as _ from 'lodash'
import traverse from 'babel-traverse'

import { IWxTransformResult } from '../util/types'
import {
  REG_TYPESCRIPT,
  processTypeEnum,
  NODE_MODULES_REG,
  NODE_MODULES
} from '../util/constants'
import {
  printLog,
  isEmptyObject,
  promoteRelativePath,
  isDifferentArray
} from '../util'

import { parseComponentExportAst, parseAst } from './astProcess'
import { IComponentObj, IBuildResult } from './interface'
import {
  setHasBeenBuiltComponents,
  isComponentHasBeenBuilt,
  getBuildData,
  setComponentExportsMap,
  getComponentExportsMap,
  getRealComponentsPathList,
  uglifyJS,
  copyFilesFromSrcToOutput,
  getComponentsBuildResult,
  getDependencyTree,
  buildUsingComponents,
  getDepComponents
} from './helper'
import { compileScriptFile, compileDepScripts } from './compileScript'
import { compileDepStyles } from './compileStyle'
import { transfromNativeComponents, processNativeWxml } from './native'
import { PARSE_AST_TYPE } from './constants'

const notTaroComponents = new Set<string>()
const componentsNamedMap = new Map<string, { name?: string, type?: string }>()

export function getComponentsNamedMap () {
  return componentsNamedMap
}

export function isFileToBeTaroComponent (
  code: string,
  sourcePath: string,
  outputPath: string
) {
  const {
    buildAdapter,
    constantsReplaceList,
    jsxAttributeNameReplace
  } = getBuildData()
  const transformResult: IWxTransformResult = wxTransformer({
    code,
    sourcePath: sourcePath,
    outputPath: outputPath,
    isNormal: true,
    isTyped: REG_TYPESCRIPT.test(sourcePath),
    adapter: buildAdapter,
    env: constantsReplaceList,
    jsxAttributeNameReplace
  })
  const { ast }: IWxTransformResult = transformResult
  let isTaroComponent = false

  traverse(ast, {
    ClassDeclaration (astPath) {
      astPath.traverse({
        ClassMethod (astPath) {
          if (astPath.get('key').isIdentifier({ name: 'render' })) {
            astPath.traverse({
              JSXElement () {
                isTaroComponent = true
              }
            })
          }
        }
      })
    },

    ClassExpression (astPath) {
      astPath.traverse({
        ClassMethod (astPath) {
          if (astPath.get('key').isIdentifier({ name: 'render' })) {
            astPath.traverse({
              JSXElement () {
                isTaroComponent = true
              }
            })
          }
        }
      })
    }
  })

  return {
    isTaroComponent,
    transformResult
  }
}

export interface IComponentBuildConfig {
  outputDir?: string,
  outputDirName?: string,
  npmSkip?: boolean
}

export function buildDepComponents (
  componentPathList: IComponentObj[],
  buildConfig?: IComponentBuildConfig
): Promise<IBuildResult[]> {
  return Promise.all(componentPathList.map(componentObj => buildSingleComponent(componentObj, buildConfig)))
}

export async function buildSingleComponent (
  componentObj: IComponentObj,
  buildConfig: IComponentBuildConfig = {}
): Promise<IBuildResult> {
  const componentsBuildResult = getComponentsBuildResult()
  if (isComponentHasBeenBuilt(componentObj.path as string) && componentsBuildResult[componentObj.path as string]) {
    return componentsBuildResult[componentObj.path as string]
  }
  const {
    appPath,
    buildAdapter,
    constantsReplaceList,
    sourceDir,
    outputDir,
    sourceDirName,
    outputDirName,
    npmOutputDir,
    nodeModulesPath,
    outputFilesTypes,
    isProduction,
    jsxAttributeNameReplace
  } = getBuildData()

  if (componentObj.path) {
    componentsNamedMap.set(componentObj.path, {
      name: componentObj.name,
      type: componentObj.type
    })
  }
  const component = componentObj.path
  if (!component) {
    printLog(processTypeEnum.ERROR, '组件错误', `组件${_.upperFirst(_.camelCase(componentObj.name))}路径错误，请检查！（可能原因是导出的组件名不正确）`)
    return {
      js: '',
      wxss: '',
      wxml: ''
    }
  }
  let componentShowPath = component.replace(appPath + path.sep, '')
  componentShowPath = componentShowPath.split(path.sep).join('/')
  let isComponentFromNodeModules = false
  let sourceDirPath = sourceDir
  let buildOutputDir = outputDir
  // 来自 node_modules 的组件
  if (NODE_MODULES_REG.test(componentShowPath)) {
    isComponentFromNodeModules = true
    sourceDirPath = nodeModulesPath
    buildOutputDir = npmOutputDir
  }
  let outputComponentShowPath = componentShowPath.replace(isComponentFromNodeModules ? NODE_MODULES : sourceDirName, buildConfig.outputDirName || outputDirName)
  outputComponentShowPath = outputComponentShowPath.replace(path.extname(outputComponentShowPath), '')
  printLog(processTypeEnum.COMPILE, '组件文件', componentShowPath)
  const componentContent = fs.readFileSync(component).toString()
  const outputComponentJSPath = component.replace(sourceDirPath, buildConfig.outputDir || buildOutputDir).replace(path.extname(component), outputFilesTypes.SCRIPT)
  const outputComponentWXMLPath = outputComponentJSPath.replace(path.extname(outputComponentJSPath), outputFilesTypes.TEMPL)
  const outputComponentWXSSPath = outputComponentJSPath.replace(path.extname(outputComponentJSPath), outputFilesTypes.STYLE)
  const outputComponentJSONPath = outputComponentJSPath.replace(path.extname(outputComponentJSPath), outputFilesTypes.CONFIG)
  if (!isComponentHasBeenBuilt(component)) {
    setHasBeenBuiltComponents(component)
  }
  try {
    const isTaroComponentRes = isFileToBeTaroComponent(componentContent, component, outputComponentJSPath)
    const componentExportsMap = getComponentExportsMap()
    if (!isTaroComponentRes.isTaroComponent) {
      const transformResult = isTaroComponentRes.transformResult
      const componentRealPath = parseComponentExportAst(transformResult.ast, componentObj.name as string, component, componentObj.type as string)
      const realComponentObj: IComponentObj = {
        path: componentRealPath,
        name: componentObj.name,
        type: componentObj.type
      }
      let isInMap = false
      notTaroComponents.add(component)
      if (!isEmptyObject(componentExportsMap)) {
        Object.keys(componentExportsMap).forEach(key => {
          componentExportsMap[key].forEach(item => {
            if (item.path === component) {
              isInMap = true
              item.path = componentRealPath
            }
          })
        })
      }
      if (!isInMap) {
        const componentExportsMapItem = componentExportsMap.get(component) || []
        componentExportsMapItem.push(realComponentObj)
        setComponentExportsMap(component, componentExportsMapItem)
      }
      return await buildSingleComponent(realComponentObj, buildConfig)
    }
    const transformResult: IWxTransformResult = wxTransformer({
      code: componentContent,
      sourcePath: component,
      outputPath: outputComponentJSPath,
      isRoot: false,
      isTyped: REG_TYPESCRIPT.test(component),
      isNormal: false,
      adapter: buildAdapter,
      env: constantsReplaceList,
      jsxAttributeNameReplace
    })
    const componentWXMLContent = isProduction ? transformResult.compressedTemplate : transformResult.template
    const componentDepComponents = transformResult.components
    const res = parseAst(PARSE_AST_TYPE.COMPONENT, transformResult.ast, componentDepComponents, component, outputComponentJSPath, buildConfig.npmSkip)
    let resCode = res.code
    resCode = await compileScriptFile(resCode, component, outputComponentJSPath, buildAdapter)
    fs.ensureDirSync(path.dirname(outputComponentJSPath))
    if (isProduction) {
      uglifyJS(resCode, component)
    }
    const { usingComponents = {} }: IConfig = res.configObj
    if (usingComponents && !isEmptyObject(usingComponents)) {
      const keys = Object.keys(usingComponents)
      keys.forEach(item => {
        componentDepComponents.forEach(component => {
          if (_.camelCase(item) === _.camelCase(component.name)) {
            delete usingComponents[item]
          }
        })
      })
      transfromNativeComponents(outputComponentJSONPath.replace(buildConfig.outputDir || buildOutputDir, sourceDirPath), res.configObj)
    }
    const dependencyTree = getDependencyTree()
    const fileDep = dependencyTree.get(component) || {}
    // 编译依赖的组件文件
    let realComponentsPathList: IComponentObj[] = []
    if (componentDepComponents.length) {
      realComponentsPathList = getRealComponentsPathList(component, componentDepComponents)
      res.scriptFiles = res.scriptFiles.map(item => {
        for (let i = 0; i < realComponentsPathList.length; i++) {
          const componentObj = realComponentsPathList[i]
          const componentPath = componentObj.path
          if (item === componentPath) {
            return ''
          }
        }
        return item
      }).filter(item => item)
      realComponentsPathList = realComponentsPathList.filter(item => isComponentHasBeenBuilt(item.path as string) || notTaroComponents.has(item.path as string))
      await buildDepComponents(realComponentsPathList)
    }
    if (!isEmptyObject(componentExportsMap) && realComponentsPathList.length) {
      const mapKeys = Object.keys(componentExportsMap)
      realComponentsPathList.forEach(componentObj => {
        if (mapKeys.indexOf(componentObj.path as string) >= 0) {
          const componentMap = componentExportsMap[componentObj.path as string]
          componentMap.forEach(componentObj => {
            componentDepComponents.forEach(depComponent => {
              if (depComponent.name === componentObj.name) {
                let componentPath = componentObj.path
                let realPath
                if (NODE_MODULES_REG.test(componentPath)) {
                  componentPath = componentPath.replace(nodeModulesPath, npmOutputDir)
                  realPath = promoteRelativePath(path.relative(outputComponentJSPath, componentPath))
                } else {
                  realPath = promoteRelativePath(path.relative(component, componentPath))
                }
                depComponent.path = realPath.replace(path.extname(realPath), '')
              }
            })
          })
        }
      })
    }
    fs.writeFileSync(outputComponentJSONPath, JSON.stringify(_.merge({}, buildUsingComponents(component, componentDepComponents, true), res.configObj), null, 2))
    printLog(processTypeEnum.GENERATE, '组件配置', `${outputDirName}/${outputComponentShowPath}${outputFilesTypes.CONFIG}`)
    fs.writeFileSync(outputComponentJSPath, resCode)
    printLog(processTypeEnum.GENERATE, '组件逻辑', `${outputDirName}/${outputComponentShowPath}${outputFilesTypes.SCRIPT}`)
    fs.writeFileSync(outputComponentWXMLPath, componentWXMLContent)
    processNativeWxml(outputComponentWXMLPath.replace(outputDir, sourceDir), componentWXMLContent, outputComponentWXMLPath)
    printLog(processTypeEnum.GENERATE, '组件模板', `${outputDirName}/${outputComponentShowPath}${outputFilesTypes.TEMPL}`)
    // 编译依赖的脚本文件
    if (isDifferentArray(fileDep['script'], res.scriptFiles)) {
      compileDepScripts(res.scriptFiles)
    }
    const depComponents = getDepComponents()
    // 编译样式文件
    if (isDifferentArray(fileDep['style'], res.styleFiles) || isDifferentArray(depComponents.get(component) || [], componentDepComponents)) {
      printLog(processTypeEnum.GENERATE, '组件样式', `${outputDirName}/${outputComponentShowPath}${outputFilesTypes.STYLE}`)
      await compileDepStyles(outputComponentWXSSPath, res.styleFiles)
    }
    // 拷贝依赖文件
    if (isDifferentArray(fileDep['json'], res.jsonFiles)) {
      copyFilesFromSrcToOutput(res.jsonFiles)
    }
    if (isDifferentArray(fileDep['media'], res.mediaFiles)) {
      copyFilesFromSrcToOutput(res.mediaFiles)
    }
    fileDep['style'] = res.styleFiles
    fileDep['script'] = res.scriptFiles
    fileDep['json'] = res.jsonFiles
    fileDep['media'] = res.mediaFiles
    dependencyTree[component] = fileDep
    depComponents.set(component, componentDepComponents)
    const buildResult = {
      js: outputComponentJSPath,
      wxss: outputComponentWXSSPath,
      wxml: outputComponentWXMLPath
    }
    componentsBuildResult.set(component, buildResult)
    return buildResult
  } catch (err) {
    printLog(processTypeEnum.ERROR, '组件编译', `组件${componentShowPath}编译失败！`)
    console.log(err)
    return {
      js: '',
      wxss: '',
      wxml: ''
    }
  }
}
