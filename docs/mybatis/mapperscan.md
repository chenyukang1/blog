## MapperScan做了什么

`@MapperScan` 是 MyBatis 框架中的一个注解，用于扫描指定包中的接口，并将它们注册为 MyBatis 的 Mapper 接口。通过使用 `@MapperScan`，我们可以避免手动在每个 Mapper 接口上添加 `@Mapper` 注解，从而简化配置。

### 主要功能

1. **自动扫描和注册**：`@MapperScan` 会自动扫描指定包中的所有接口，并将它们注册为 MyBatis 的 Mapper 接口。
2. **简化配置**：通过使用 `@MapperScan`，我们可以避免在每个 Mapper 接口上手动添加 `@Mapper` 注解。
3. **提高开发效率**：减少了重复的配置工作，使得开发过程更加高效。

### 使用示例

```java
// filepath: /path/to/your/Application.java
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
@MapperScan("com.example.mapper")
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

### 原理解析

`@MapperScan` 会通过 `@Import` 注入一个 `MapperScannerRegistrar`，`MapperScannerRegistrar` 会在处理 `@Configuration` 的类的时候注册额外的 bean 定义。为什么这么做呢，我的理解是这个 bean 定义的优先级比较低，放在最后去做就行了

看一下 `MapperScannerRegistrar` 的代码，会发现注册的是 bean 的 class 类型为 `MapperScannerConfigurer` 的 bean 定义。这个 `MapperScannerConfigurer` 就厉害了，javadoc 告诉我们 `MapperScannerConfigurer` 会递归地扫描包下的接口，然后把他们注册为 `MapperFactoryBean`

`MapperScannerConfigurer` 通过实现 `BeanDefinitionRegistryPostProcessor` 接口来实现它的功能

```java
@Override
  public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
    if (this.processPropertyPlaceHolders) {
      processPropertyPlaceHolders();
    }

    ClassPathMapperScanner scanner = new ClassPathMapperScanner(registry);
    scanner.setAddToConfig(this.addToConfig);
    scanner.setAnnotationClass(this.annotationClass);
    scanner.setMarkerInterface(this.markerInterface);
    scanner.setSqlSessionFactory(this.sqlSessionFactory);
    scanner.setSqlSessionTemplate(this.sqlSessionTemplate);
    scanner.setSqlSessionFactoryBeanName(this.sqlSessionFactoryBeanName);
    scanner.setSqlSessionTemplateBeanName(this.sqlSessionTemplateBeanName);
    scanner.setResourceLoader(this.applicationContext);
    scanner.setBeanNameGenerator(this.nameGenerator);
    scanner.setMapperFactoryBeanClass(this.mapperFactoryBeanClass);
    if (StringUtils.hasText(lazyInitialization)) {
      scanner.setLazyInitialization(Boolean.valueOf(lazyInitialization));
    }
    if (StringUtils.hasText(defaultScope)) {
      scanner.setDefaultScope(defaultScope);
    }
    scanner.registerFilters();
    scanner.scan(
        StringUtils.tokenizeToStringArray(this.basePackage, ConfigurableApplicationContext.CONFIG_LOCATION_DELIMITERS));
  }
```

`ClassPathMapperScanner` 这个类继承了默认实现，然后重写了 doScan 方法，当扫描完成后把注解上的元数据填充到每个对应的 bean 定义上。最终我们实现的接口都被注册成 `MapperFactoryBean`

`MapperFactoryBean` 实现了 `FactoryBean` 接口，表示它是一个工厂 bean，负责 bean 的创建

```java
public class MapperFactoryBean<T> extends SqlSessionDaoSupport implements FactoryBean<T> {

  private Class<T> mapperInterface;

@Override
  protected void checkDaoConfig() {
    super.checkDaoConfig();

    notNull(this.mapperInterface, "Property 'mapperInterface' is required");

    Configuration configuration = getSqlSession().getConfiguration();
    if (this.addToConfig && !configuration.hasMapper(this.mapperInterface)) {
      try {
        configuration.addMapper(this.mapperInterface);
      } catch (Exception e) {
        logger.error("Error while adding the mapper '" + this.mapperInterface + "' to configuration.", e);
        throw new IllegalArgumentException(e);
      } finally {
        ErrorContext.instance().reset();
      }
    }
  }

  @Override
  public T getObject() throws Exception {
    return 
    getSqlSession().getMapper(this.mapperInterface);
  }
}
```

`MapperFactoryBean` 持有接口方法类的引用，在 `MapperFactoryBean` 这个工厂 bean 实例后就会触发 `checkDaoConfig` 方法，一方面检查数据库配置，另一方面把当前接口方法类的引用加入到全局配置 `Configuration` 中的 `MapperRegistry`，它通过 `map` 存储了所有接口类和 `MapperProxyFactory` 的映射关系

最终当 bean 实例化发生时，走到 `getObject` 方法，`getSqlSession()` 方法会拿到 `SqlSessionTemplate`，在 mybatis 中 `SqlSessionTemplate` 是对一次会话的抽象，最终由 `MapperRegistry` 处理

```java
  @SuppressWarnings("unchecked")
  public <T> T getMapper(Class<T> type, SqlSession sqlSession) {
    final MapperProxyFactory<T> mapperProxyFactory = (MapperProxyFactory<T>) knownMappers.get(type);
    if (mapperProxyFactory == null) {
      throw new BindingException("Type " + type + " is not known to the MapperRegistry.");
    }
    try {
      return mapperProxyFactory.newInstance(sqlSession);
    } catch (Exception e) {
      throw new BindingException("Error getting mapper instance. Cause: " + e, e);
    }
  }
```

```java
  @SuppressWarnings("unchecked")
  protected T newInstance(MapperProxy<T> mapperProxy) {
    return (T) Proxy.newProxyInstance(mapperInterface.getClassLoader(), new Class[] { mapperInterface }, mapperProxy);
  }

  public T newInstance(SqlSession sqlSession) {
    final MapperProxy<T> mapperProxy = new MapperProxy<>(sqlSession, mapperInterface, methodCache);
    return newInstance(mapperProxy);
  }
```

`MapperProxy` 是实现了 `InvocationHandler` 的处理类，可见最终通过 jdk 动态代理生成每个接口对应的实现类，jdk 动态代理会通过字节码增强技术生成 $Proxy 类，$Proxy 类的方法签名与被代理类相同，指向 `InvocationHandler` 类的 invoke 方法

### 总结

1. 递归地扫描包下的接口，然后把他们注册为 `MapperFactoryBean`
2. 当 bean 实例化发生时，通过 jdk 动态代理生成每个接口对应的实现类