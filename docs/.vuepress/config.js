module.exports = {
  title: '我的博客',
  description: '陈宇康的博客',
  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      {
        text: "陈宇康的博客",
        items: [
          { text: "Github", link: "https://github.com/chenyukang1" }
        ]
      }
    ],
    sidebar: [
      {
        title: "欢迎学习",
        path: "/",
        collapsable: false,
        children: [{ title: "博客简介", path: "/" }],
      },
      {
        title: "数据库",
        path: "/database/neo4j",
        collapsable: true,
        children: [
          { title: "Neo4j", path: "/database/neo4j" },
        ]
      } 
    ]
  }
}

