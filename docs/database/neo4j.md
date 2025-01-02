## 基本概念

### 节点

节点（或顶点）是图中的圆。节点通常代表物体、实体或单纯的事物

#### 标签 Label

在节点上添加标签，就表示该节点属于图中的一个节点子集。 标签在 Neo4j 中非常重要，因为它们为 Cypher 语句提供了一个起点

![Nodes with labels](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/1-property-graph/images/node-labels.jpg)

#### 属性 Properties

属性是键、值对，可根据需要从节点中添加或删除。 属性值可以是单个值，也可以是符合 Cypher 类型系统的值列表

![Nodes with properties](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/1-property-graph/images/node-properties.jpg)

### 关系

关系（或边）用于连接节点。我们可以使用关系来描述节点之间的连接方式

#### 方向 Direction

在 Neo4j 中，每个关系在图中都必须有一个方向。 虽然这个方向是必须的，但关系可以在任何一个方向上查询，也可以在查询时完全忽略

#### 类型 Type

Neo4j 图形中的每个关系都必须有一个类型。 这样，我们就可以在查询时选择要遍历图的哪一部分

#### 属性 Properties

与节点一样，关系也可以具有属性。 这些属性可以是加权图中的成本或距离，也可以只是为关系提供额外的上下文

## 为什么用Neo4j

- Neo4j 是一个**原生图数据库**，这意味着从数据存储到查询语言的所有设计都考虑到了遍历。在类似多跳查询的场景有非常高的查询效率

- 与其他企业 DBMS 一样，Neo4j 也符合 ACID 标准。 事务中的一组修改要么全部提交，要么全部失败

- 免索引邻接

## 免索引邻接（Index-Free Adjacency）

免索引邻接（Index-Free Adjacency） 是一种数据存储和查询优化技术，主要用于图数据库（Graph Database）中。与传统的关系型数据库不同，图数据库通过节点（Node）和边（Edge）来表示实体及其关系。免索引邻接的核心思想是将相邻节点的引用直接存储在节点本身中，而不是依赖于全局索引来查找关联数据

### 工作原理

在免索引邻接模型中，每个节点都包含对其相邻节点的直接引用（通常是内存地址或指针）。这意味着当需要访问某个节点的邻居时，可以直接通过这些引用快速定位到相关节点，而无需进行复杂的索引查找操作

### 数据结构

常见的实现方式包括：

- 链表：每个节点维护一个指向其相邻节点的链表

- 数组：使用数组或列表来存储相邻节点的引用

- 哈希表：对于稀疏图，可以使用哈希表来存储相邻节点的引用，以提高查找效率

### 概念图

![IFA-1-new](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/2-native-graph/images/IFA-1-new.png)

![IFA-2-new](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/2-native-graph/images/IFA-2-new.png)

```cypher
MATCH (n) <-- (:Group) <-- (:Group) <-- (:Group {id: 3})

RETURN n.id
```

![IFA-3-new](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/2-property-graphs/2-native-graph/images/IFA-3-new.png)

### 优点

#### 高效的遍历性能

由于不需要通过索引查找相邻节点，免索引邻接大大提高了图遍历的速度。特别是在深度优先搜索（DFS）、广度优先搜索（BFS）等算法中，能够显著减少查询延迟

#### 减少索引开销

传统的关系型数据库需要为每种关系类型创建索引，这会占用大量的存储空间并增加写入操作的复杂性。免索引邻接避免了这些问题，减少了索引维护的开销

#### 简化查询逻辑

查询逻辑变得更加直观和简单。开发者可以直接通过节点的引用访问相邻节点，而无需编写复杂的 SQL 查询语句或处理多表连接

### 缺点

#### 内存占用较高

由于每个节点都需要存储其相邻节点的引用，这可能会导致较大的内存开销，尤其是在图非常稠密的情况下

#### 不适合频繁更新的场景

如果图结构频繁变化（如节点和边的增删），维护这些直接引用会变得复杂且耗时。每次修改图结构时，都需要更新相关节点的引用信息

## 参考

https://graphacademy.neo4j.com/courses/neo4j-fundamentals
